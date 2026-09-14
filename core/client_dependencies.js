// Optional network dependency: loaded only when creating/joining a PVP room.
const clientDependencies = (() => {
    let peerPromise = null;
    function loadPeer() {
        if (typeof Peer === 'function') return Promise.resolve(Peer);
        if (peerPromise) return peerPromise;
        peerPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            let settled = false;
            const finish = error => {
                if (settled) return;
                settled = true; clearTimeout(timer); script.onload = script.onerror = null;
                if (error) { script.remove(); reject(error); }
                else resolve(Peer);
            };
            const timer = setTimeout(() => finish(new Error('联机组件加载超时，请重试')), 10000);
            script.onload = () => finish(typeof Peer === 'function' ? null : new Error('联机组件无效，请重试'));
            script.onerror = () => finish(new Error('联机组件加载失败，请检查网络后重试'));
            script.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
            document.head.appendChild(script);
        }).catch(error => { peerPromise = null; throw error; });
        return peerPromise;
    }
    return { loadPeer };
})();
