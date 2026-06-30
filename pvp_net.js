// pvp_net.js - PeerJS 信令(公共免费信令服务器) + WebRTC 传输 + 时钟同步
// 不含任何游戏逻辑，不直接操作 DOM（除 status 回调外）
//
// 改造说明：
// 原方案需要手动两次交换 SDP 文本(offer/answer)，容易出错且对"扫码即连"体验很差。
// 现改为：双方各自连上 PeerJS 的公共信令服务器(0.peerjs.com，免费，仅用于打洞撮合，
// 不经过它转发游戏数据)，约定一个"房间号"，Host 用房间号注册，Guest 用房间号直连。
// 全程只需交换一个房间号（4-6 位数字/字符），可用二维码或手输，不再需要二次粘贴应答码。

const pvpNet = (() => {
    const PING_ROUNDS = 5;
    const PING_INTERVAL_MS = 200;
    const PEER_OPEN_TIMEOUT_MS = 12000;

    // PeerJS 公共信令服务器配置（仅做信令撮合，不转发游戏数据）
    // 如果默认服务器不稳定，可以换成自建的 PeerServer，把这里的 config 改掉即可。
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
    let _clockOffset = 0;   // 应用到所有远端时间戳: corrected = remote_t + offset
    let _rtt = 0;
    let _lastRoomCode = null;  // 记录最近一次使用的房间号，供断线重连时复用

    // 由 pvp_room / pvp_logic 设置的回调
    const on = {
        open:     null,   // () 仅 host 侧，在时钟同步完成后触发
        connOpen: null,   // () 双方都会触发，数据通道刚打开那一刻（不等时钟同步）
        message:  null,   // (msg)
        close:    null,   // ()
        error:    null,   // (err)
        status:   null,   // (text) 给 UI 显示状态用
    };

    // ── 内部辅助 ────────────────────────────────────────────────────

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
            // 双方都立即触发，不等时钟同步——pvp_room.js 用这个时机做一次
            // "hello" 握手，判断对方是不是刷新页面后重新连进来的（内存状态已丢失），
            // 也用它互换战斗数值资料。
            _emit('connOpen');

            if (_role === 'host') {
                _runClockSync().then(() => _emit('open'));
            }
            // guest 等待 host 发起 ping，自己不主动 emit open
        }

        // 这里有个容易踩的坑：host 端是从 _peer.on('connection') 里直接调用
        // _attachConn 的，这时候数据通道还没真正 open，用 conn.on('open', ...)
        // 等未来才会发生的事件没问题。
        // 但 guest 端是从 joinRoom()/reconnect() 里调用的——那两个函数都是先
        // 自己 conn.on('open', ...) 等到事件发生之后，再在那个回调里调用
        // _attachConn(conn)。也就是说传进来的这个 conn，它的 'open' 事件早就已经
        // 发生过、已经"过去"了。如果这里还无条件再 conn.on('open', ...) 重新注册
        // 一次，等的是同一个只会触发一次的事件——但它已经触发完了，这次注册永远
        // 等不到，里面的逻辑（包括 connOpen 广播 hello）就成了死代码，guest 端的
        // hello 从来没真正发出去过。
        // 用 conn.open 这个同步布尔属性判断当前是否已经开过，两条路径都能正确
        // 触发恰好一次。
        if (conn.open) {
            _onChannelOpen();
        } else {
            conn.on('open', _onChannelOpen);
        }

        conn.on('data', (msg) => {
            // PeerJS 默认按 JSON 序列化，data 已经是解析好的对象
            _handleMessage(msg);
        });

        conn.on('close', () => {
            // 注意：这里只清掉具体的 data connection，不销毁 _peer。
            // Host 的 peer.on('connection') 监听是持久的，guest 断线后重连同一房间号依然能命中；
            // 彻底退出（放弃重连）走 close() 方法，会真正销毁 peer。
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

    // ── 时钟同步 ──────────────────────────────────────────────────
    // Host 发 ping，guest 回 pong。
    // offset = avg((t1 - t0 - RTT) / 2)，共 PING_ROUNDS 轮

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

    // ── 内部发送 ──────────────────────────────────────────────────

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

    // ── 公开 API ──────────────────────────────────────────────────

    return {
        get role()        { return _role; },
        get clockOffset() { return _clockOffset; },
        get rtt()         { return _rtt; },
        get lastRoomCode() { return _lastRoomCode; },
        on,

        now()                   { return Date.now(); },
        // offset 的定义是「guest时钟 - host时钟」（见 _runClockSync 里的 NTP 公式）。
        // 所以把一个对方时钟读数换算成本机时钟等效读数，要做的是减去 offset，
        // 不是加上——加号会导致换算结果偏离真实值达 2×offset，方向还可能是
        // 把对方事件的发生时间"推到未来"，这正是导致格挡/弹反误判的根本原因。
        correctRemote(remote_t) { return remote_t - _clockOffset; },

        // ── Host: 用房间号注册到信令服务器，等待 Guest 连入 ─────────
        // 返回最终生效的房间号（一般等于传入的 roomCode）
        async hostRoom(roomCode) {
            _role = 'host';
            _lastRoomCode = roomCode;
            _peer = _makePeer(roomCode);

            _peer.on('connection', (conn) => {
                _attachConn(conn);
            });

            const id = await _waitForPeerOpen(_peer);
            return id;
        },

        // ── Guest: 用房间号直接连接 Host ─────────────────────────────
        async joinRoom(roomCode) {
            _role = 'guest';
            _lastRoomCode = roomCode;
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

        // ── 发送游戏消息 ──────────────────────────────────────────────
        send(obj) {
            return _send(obj);
        },

        // 发送带校正时间戳的玩家动作
        sendAction(type, hand = null) {
            return _send({
                msg:  'action',
                type,
                hand,
                t: this.now()
            });
        },

        // ── 彻底拆除连接（放弃重连）─────────────────────────────────────
        close() {
            if (_conn) { try { _conn.close();   } catch (_) {} }
            if (_peer) { try { _peer.destroy(); } catch (_) {} }
            _conn         = null;
            _peer         = null;
            _role         = null;
            _clockOffset  = 0;
            _rtt          = 0;
            _lastRoomCode = null;
        }
    };
})();