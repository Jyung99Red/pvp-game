const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function harness(overrides = {}) {
    const nodes = [], listeners = {}, timers = new Map(), requests = [];
    const root = { dataset: {} }; let timerId = 0, initialized = 0, c;
    const element = tag => ({ tag, dataset: {}, style: {}, textContent: '', isConnected: false,
        remove() { this.isConnected = false; }, setAttribute() {}, addEventListener() {},
        appendChild(node) { node.isConnected = true; nodes.push(node); return node; }
    });
    const document = { documentElement: root, currentScript: { dataset: { entry: 'game' } }, hidden: false,
        createElement: element, getElementById: id => nodes.find(n => n.id === id && n.isConnected),
        addEventListener(type, fn) { listeners[type] = fn; }, head: element('head'), body: element('body') };
    document.head.appendChild = node => { node.isConnected = true; nodes.push(node); node.sheet = { cssRules: [{}, {}] }; return node; };
    document.body.appendChild = node => {
        node.isConnected = true; nodes.push(node);
        if (node.tag === 'script' && !node.src) vm.runInContext(node.textContent, c);
        return node;
    };
    const responses = { 'client-assets.json': JSON.stringify({ game: { styles: ['style.css'], scripts: ['first.js','second.js','core/client_dependencies.js'] } }),
        'style.css': 'body { color: red; }', 'first.js': 'var order = [1];', 'second.js': 'order.push(2);',
        'core/client_dependencies.js': source('core/client_dependencies.js'), ...overrides.responses };
    c = vm.createContext({ document, console: { error() {} }, AbortController, location: { reload() {} },
        ui: { init() { initialized++; assert.deepEqual(Array.from(c.order), [1,2]); } },
        window: { addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; } },
        getComputedStyle: () => ({ getPropertyValue: key => !overrides.invalidStyles && nodes.some(n => n.isConnected && n.tag === 'style' && n.textContent.includes(key)) ? 'ready' : '' }),
        setTimeout(fn) { timers.set(++timerId,fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
        fetch: async (url, options) => {
            requests.push({url,options});
            if (overrides.fetch) { const value = await overrides.fetch(url, requests); if (value != null) return {ok:true,text:async()=>value}; }
            return { ok: true, text: async () => responses[url] };
        }
    });
    return { c, document, nodes, listeners, timers, requests, root, initialized: () => initialized,
        run: () => vm.runInContext(source('core/client_boot.js'), c) };
}
test('local boot applies CSS and ordered scripts without requesting PeerJS', async () => {
    const h=harness(); await h.run();
    assert.equal(h.root.dataset.clientState,'ready'); assert.equal(h.initialized(),1);
    assert.ok(h.requests.every(r=>r.options.cache==='no-store' && !r.url.startsWith('https:')));
    assert.equal(h.nodes.filter(n=>n.src).length,0); assert.equal(h.timers.size,0);
});
test('boot retries invalid CSS responses and keeps a persistent failure behind loading screen', async () => {
    const h=harness({fetch:(url,requests)=>url==='style.css' && requests.filter(r=>r.url===url).length===1 ? '<html>upstream error</html>' : null});
    await h.run(); assert.equal(h.initialized(),1); assert.equal(h.requests.filter(r=>r.url==='style.css').length,2);
    const broken=harness({responses:{'style.css':''}}); await broken.run();
    assert.equal(broken.initialized(),0); assert.equal(broken.root.dataset.clientState,'loading');
    assert.match(broken.document.getElementById('client-loading').textContent,/未能完整加载/);
});
test('unapplied CSS blocks startup; pageshow restores missing styles without initializing twice',async()=>{
    const bad=harness({invalidStyles:true}); await bad.run(); assert.equal(bad.initialized(),0);
    const h=harness(); await h.run(); h.nodes.find(n=>n.tag==='style').remove();
    h.listeners.pageshow();
    assert.equal(h.nodes.filter(n=>n.tag==='style' && n.isConnected).length,1); assert.equal(h.initialized(),1);
});
test('PeerJS is single-flight, times out cleanly and retries on the next request',async()=>{
    const h=harness(); await h.run(); const deps=vm.runInContext('clientDependencies',h.c);
    const first=deps.loadPeer(); assert.equal(deps.loadPeer(),first);
    const rejected=assert.rejects(first,/超时/);
    for(const fn of [...h.timers.values()])fn(); await rejected;
    assert.equal(h.nodes.filter(n=>n.src && n.isConnected).length,0);
    const retry=deps.loadPeer(); h.c.Peer=function Peer(){};
    h.nodes.find(n=>n.src && n.isConnected).onload(); assert.equal(await retry,h.c.Peer);
    assert.equal(h.timers.size,0);
});
test('cancelled room creation cannot resume after the optional dependency loads',async()=>{
    let resolve; const h=harness();
    h.c.clientDependencies={loadPeer:()=>new Promise(r=>resolve=r)};
    h.c.Peer=function(){throw new Error('must not construct a cancelled peer')};
    vm.runInContext(source('pvp/pvp_net.js'),h.c);
    const net=vm.runInContext('pvpNet',h.c), started=net.hostRoom('123456');
    net.close(); resolve(); await assert.rejects(started,/取消/); assert.equal(net.role,null);
});

test('room dependency failures return to a usable retry entry',async()=>{
    const status={textContent:''}, steps=new Map();
    const h=harness();
    for(const id of ['pvp-step-entry','pvp-step-hosting','pvp-step-joining']) steps.set(id,{id,classList:{toggle(_,hidden){this.hidden=hidden}}});
    h.c.document.querySelectorAll=selector=>selector==='.pvp-status-text'?[status]:selector==='.pvp-step'?[...steps.values()]:[];
    h.c.document.querySelector=()=>({value:'fair'});
    h.c.pvpLogic={MODES:{fair:{label:'公平'}},setMode:()=>!h.c.pvpNet.role};
    h.c.pvpNet={role:null,on:{},async hostRoom(){this.role='host';throw new Error('联机组件超时')},close(){this.role=null}};
    vm.runInContext(source('pvp/pvp_room.js'),h.c);
    const room=vm.runInContext('pvpRoom',h.c); await room.hostRoom();
    assert.equal(h.c.pvpNet.role,null); assert.equal(steps.get('pvp-step-entry').classList.hidden,false);
    assert.match(status.textContent,/创建失败/); await room.hostRoom(); assert.equal(h.c.pvpNet.role,null);
});

test('rooms generate and accept exactly four digits',async()=>{
    const status={textContent:''}, steps=new Map(), input={value:'12345'}; let hosted='';
    const h=harness();
    for(const id of ['pvp-step-entry','pvp-step-hosting','pvp-step-host-waiting','pvp-step-joining','pvp-step-joining-wait']) steps.set(id,{id,classList:{toggle(_,hidden){this.hidden=hidden}}});
    h.c.document.querySelectorAll=selector=>selector==='.pvp-status-text'?[status]:selector==='.pvp-step'?[...steps.values()]:selector==='input[name="pvp-mode"]'?[]:[];
    h.c.document.querySelector=()=>({value:'fair'});
    h.c.document.getElementById=id=>id==='pvp-room-code-input'?input:null;
    h.c.pvpLogic={MODES:{fair:{label:'公平'}},setMode:()=>true};
    h.c.pvpNet={role:null,on:{},async hostRoom(code){hosted=code;this.role='host'},async joinRoom(){throw new Error('invalid code reached network')},close(){this.role=null}};
    vm.runInContext('Math.random = () => 0',h.c);
    vm.runInContext(source('pvp/pvp_room.js'),h.c);
    const room=vm.runInContext('pvpRoom',h.c); await room.hostRoom();
    assert.equal(hosted,'1000'); assert.match(hosted,/^\d{4}$/);
    await room.joinRoom(); assert.match(status.textContent,/4 位房间号/);
});
