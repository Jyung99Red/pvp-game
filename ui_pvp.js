// pvp_net.js - PeerJS signaling (free public signaling server) + WebRTC transport + clock sync
// Contains no game logic and never touches the DOM directly (except via the status callback)
//
// Design note:
// The original approach required manually exchanging SDP text (offer/answer) twice -- error
// prone and a poor fit for a "scan and connect" experience. Now: both sides connect to PeerJS's
// public signaling server (0.peerjs.com, free, used only for NAT traversal matchmaking, never
// relays game data), agree on a "room code", Host registers under the room code, Guest connects
// directly to it. The whole flow only needs exchanging one room code (4-6 digit/char), shareable
// via QR code or typing it in -- no more pasting an answer code back and forth.

const pvpNet = (() => {
    const PING_ROUNDS = 5;
    const PING_INTERVAL_MS = 200;
    const PEER_OPEN_TIMEOUT_MS = 12000;

    // Public PeerJS signaling server config (matchmaking only, never relays game data)
    // If the default server is unstable, swap in a self-hosted PeerServer by changing this config.
    const PEER_CONFIG = {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    };

    let _peer = null;
    let _conn = null;
    let _role = null;       // 'host' | 'guest'
    let _clockOffset = 0;   // Applied to every remote timestamp as: corrected = remote_t - offset
                             // (see the longer explanation on correctRemote() below for why it's
                             // a subtraction, not addition)
    let _rtt = 0;

    // Callbacks set by pvp_room / pvp_logic
    const on = {
        open:     null,   // () Host side only, fires once clock sync completes
        connOpen: null,   // () fires on both sides, the moment the data channel first opens (doesn't wait for clock sync)
        message:  null,   // (msg)
        close:    null,   // ()
        error:    null,   // (err)
        status:   null,   // (text) for the UI to display status
    };

    // ── Internal helpers ───────────────────────────────────────────────

    function _emit(event, ...args) {
        if (on[event]) on[event](...args);
    }

    function _status(text) {
        _emit('status', text);
    }

    function _attachConn(conn) {
        _conn = conn;

        function _onChannelOpen() {
            _status('数据通道已建立');
            // Fires immediately on both sides, doesn't wait for clock sync --
            // pvp_room.js uses this moment to do a "hello" handshake, to
            // figure out whether the other side reconnected after a page
            // refresh (its in-memory state already lost), and to exchange
            // combat profile data.
            _emit('connOpen');

            if (_role === 'host') {
                _runClockSync().then(() => _emit('open'));
            }
            // Guest waits for Host to initiate ping; it never emits 'open' itself
        }

        // An easy trap here: on the Host side, _attachConn is called directly
        // from _peer.on('connection'), at which point the data channel hasn't
        // truly opened yet, so registering conn.on('open', ...) to wait for a
        // future event is fine.
        // But on the Guest side, _attachConn is called from joinRoom()/reconnect()
        // -- both of those functions already wait on their own conn.on('open', ...)
        // for the event to fire, and only then call _attachConn(conn) from
        // inside that callback. Which means the conn passed in here already
        // had its 'open' event fire in the past -- it's already "over". If we
        // unconditionally register conn.on('open', ...) again here, we'd be
        // waiting on an event that only fires once -- but it already fired,
        // so this registration would never fire, and everything inside it
        // (including connOpen broadcasting hello) becomes dead code; the
        // Guest's hello would never actually be sent.
        // Checking conn.open, a synchronous boolean property for whether it's
        // already open, lets both code paths fire exactly once correctly.
        if (conn.open) {
            _onChannelOpen();
        } else {
            conn.on('open', _onChannelOpen);
        }

        conn.on('data', (msg) => {
            // PeerJS serializes as JSON by default, so data is already a parsed object
            _handleMessage(msg);
        });

        conn.on('close', () => {
            // This only clears the specific data connection, not _peer --
            // Host's peer.on('connection') listener is persistent, so
            // technically a Guest can joinRoom() with the same room code
            // again and still reach the same Host. But that doesn't mean
            // "resuming the battle": once pvp_room.js receives this close
            // event, if a battle was in progress it always goes through
            // abortToLobby() + shows the disconnect overlay, whose only exit
            // is "return to lobby" (giveUpToLobby, which fully destroys the
            // peer). Rejoining the same room code afterwards only ever starts
            // a brand new battle (triggered by a battleId mismatch in the
            // hello message). What actually destroys _peer is the close()
            // method below.
            _conn = null;
            _clockOffset = 0;
            _rtt = 0;
            _emit('close');
        });
        conn.on('error', (e) => _emit('error', e));
    }

    function _makePeer(id) {
        const peer = id ? new Peer(id, PEER_CONFIG) : new Peer(PEER_CONFIG);

        peer.on('disconnected', () => {
            // Note: this is PeerJS's own auto-reconnect between itself and
            // the signaling server -- a different thing from "disconnected
            // mid-battle". It has no effect on, and doesn't restore, an
            // already-closed WebRTC data channel (that's handled in
            // conn.on('close') instead).
            _status('信令服务器断开，尝试重连...');
            try { peer.reconnect(); } catch (_) {}
        });

        peer.on('close', () => _emit('close'));

        return peer;
    }

    function _waitForPeerOpen(peer) {
        return new Promise((resolve, reject) => {
            if (peer.open) { resolve(peer.id); return; }

            const timeout = setTimeout(() => {
                reject(new Error('连接信令服务器超时，请检查网络'));
            }, PEER_OPEN_TIMEOUT_MS);

            peer.on('open', (id) => {
                clearTimeout(timeout);
                resolve(id);
            });

            peer.on('error', (e) => {
                clearTimeout(timeout);
                reject(_friendlyPeerError(e));
            });
        });
    }

    function _friendlyPeerError(e) {
        const type = e && e.type;
        const map = {
            'peer-unavailable': '房间号不存在或对方已离线',
            'unavailable-id':   '房间号已被占用，请重新生成',
            'network':          '网络错误，请检查网络连接',
            'server-error':     '信令服务器错误，请重试',
            'browser-incompatible': '当前浏览器不支持 WebRTC'
        };
        const msg = map[type] || (e && e.message) || String(e);
        const err = new Error(msg);
        err.type = type;
        return err;
    }

    // ── Clock sync ───────────────────────────────────────────────────────
    // Host sends ping, Guest replies pong.
    // offset = avg((t1 - t0 - RTT) / 2), over PING_ROUNDS rounds

    const _pingCallbacks = {};

    function _runClockSync() {
        return new Promise((resolve) => {
            const samples = [];
            let round = 0;

            function sendPing() {
                if (round >= PING_ROUNDS) {
                    _clockOffset = samples.reduce((a, b) => a + b.offset, 0) / samples.length;
                    _rtt         = samples.reduce((a, b) => a + b.rtt,    0) / samples.length;
                    _status(`时钟同步完成  offset=${_clockOffset.toFixed(1)}ms  rtt=${_rtt.toFixed(1)}ms`);
                    resolve();
                    return;
                }

                const t0 = Date.now();
                _pingCallbacks[t0] = (t1) => {
                    const tRecv = Date.now();
                    const rtt    = tRecv - t0;
                    const offset = t1 - t0 - rtt / 2;
                    samples.push({ offset, rtt });
                    round++;
                    setTimeout(sendPing, PING_INTERVAL_MS);
                };

                _send({ msg: 'ping', t0 });
            }

            sendPing();
        });
    }

    function _handleMessage(msg) {
        switch (msg.msg) {
            case 'ping':
                _send({ msg: 'pong', t0: msg.t0, t1: Date.now() });
                break;

            case 'pong':
                if (_pingCallbacks[msg.t0]) {
                    _pingCallbacks[msg.t0](msg.t1);
                    delete _pingCallbacks[msg.t0];
                }
                break;

            default:
                _emit('message', msg);
                break;
        }
    }

    // ── Internal send ──────────────────────────────────────────────────

    function _send(obj) {
        if (!_conn || !_conn.open) return false;
        try {
            _conn.send(obj);
            return true;
        } catch (e) {
            _emit('error', e);
            return false;
        }
    }

    // ── Public API ──────────────────────────────────────────────────────

    return {
        get role()        { return _role; },
        get clockOffset() { return _clockOffset; },
        get rtt()         { return _rtt; },
        on,

        now()                   { return Date.now(); },
        // offset is defined as "guest clock - host clock" (see the NTP-style
        // formula in _runClockSync). So converting a remote clock reading
        // into its local-clock equivalent means subtracting offset, not
        // adding it -- adding would push the result up to 2x offset away from
        // the real value, and in the direction that pushes the remote event's
        // time "into the future", which is exactly what caused the block/parry
        // misjudgments in earlier versions.
        correctRemote(remote_t) { return remote_t - _clockOffset; },

        // ── Host: register under the room code on the signaling server, wait for Guest ──
        // Returns the room code actually in effect (normally the same as the passed-in roomCode)
        async hostRoom(roomCode) {
            _role = 'host';
            _peer = _makePeer(roomCode);

            _peer.on('connection', (conn) => {
                _attachConn(conn);
            });

            const id = await _waitForPeerOpen(_peer);
            return id;
        },

        // ── Guest: connect directly to Host using the room code ──────────
        async joinRoom(roomCode) {
            _role = 'guest';
            _peer = _makePeer();

            await _waitForPeerOpen(_peer);

            return new Promise((resolve, reject) => {
                const conn = _peer.connect(roomCode, { reliable: true, serialization: 'json' });

                const timeout = setTimeout(() => {
                    reject(new Error('连接超时，请确认房间号正确且对方仍在等待'));
                }, PEER_OPEN_TIMEOUT_MS);

                conn.on('open', () => {
                    clearTimeout(timeout);
                    _attachConn(conn);
                    resolve();
                });

                conn.on('error', (e) => {
                    clearTimeout(timeout);
                    reject(_friendlyPeerError(e));
                });

                _peer.on('error', (e) => {
                    clearTimeout(timeout);
                    reject(_friendlyPeerError(e));
                });
            });
        },

        // ── Send a game message ───────────────────────────────────────────
        send(obj) {
            return _send(obj);
        },

        // ── Fully tear down the connection (call before returning to lobby / leaving the page; truly destroys the peer) ──
        close() {
            if (_conn) { try { _conn.close();   } catch (_) {} }
            if (_peer) { try { _peer.destroy(); } catch (_) {} }
            _conn         = null;
            _peer         = null;
            _role         = null;
            _clockOffset  = 0;
            _rtt          = 0;
        }
    };
})();