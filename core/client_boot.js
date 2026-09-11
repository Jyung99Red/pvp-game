// Resolve the current asset list before mounting live partials. A cached HTML shell
// must never combine old combat code/styles with a freshly fetched battle view.
(async () => {
    const entry = document.currentScript.dataset.entry;
    const loading = document.createElement('div');
    loading.textContent = '正在加载游戏…';
    loading.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#101b20;color:#e5efed;display:grid;place-content:center;font:14px system-ui;gap:16px;text-align:center';
    document.body.appendChild(loading);
    async function read(path) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) throw new Error(`加载失败：${path} (${response.status})`);
        return response.text();
    }
    try {
        const assets = JSON.parse(await read('client-assets.json'))[entry];
        const localScripts = assets.scripts.filter(path => !path.startsWith('https:'));
        const paths = [...assets.styles, ...localScripts, ...(assets.partials || []).map(id => `partials/${id}.html`)];
        // Finish all local downloads before executing code or opening the game.
        const sources = new Map(await Promise.all(paths.map(async path => [path, await read(path)])));
        for (const path of assets.styles) {
            const style = document.createElement('style'); style.dataset.source = path;
            style.textContent = sources.get(path); document.head.appendChild(style);
        }
        for (const id of assets.partials || []) document.getElementById(`mount-${id}`).outerHTML = sources.get(`partials/${id}.html`);
        for (const path of assets.scripts) {
            const script = document.createElement('script');
            if (path.startsWith('https:')) {
                await new Promise(resolve => {
                    script.onload = resolve;
                    // A failed PVP CDN must not prevent local PVE from opening.
                    script.onerror = () => { console.warn(`外部依赖加载失败：${path}`); resolve(); };
                    script.src = path; document.body.appendChild(script);
                });
            } else {
                let failure;
                const onError = event => { failure = event.error || new Error(event.message); };
                window.addEventListener('error', onError);
                script.textContent = sources.get(path) + `\n//# sourceURL=${path}`;
                document.body.appendChild(script);
                window.removeEventListener('error', onError);
                if (failure) throw failure;
            }
        }
        if (entry === 'game') ui.init();
        loading.remove();
    } catch (error) {
        console.error(error);
        loading.textContent = '游戏资源未能完整加载，请检查连接后重试。';
        const retry = document.createElement('button'); retry.textContent = '重新加载';
        retry.addEventListener('click', () => location.reload()); loading.appendChild(retry);
    }
})();
