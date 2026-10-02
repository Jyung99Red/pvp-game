// The save (rebuild-plan.md M5; a new format, older saves are not read):
// { v, bosses: { kind: true }, chests: { 'region/chest id': true },
//   inventory: { gold, items: { id: count } }, edits: { region: [[col, row,
//   kind, level]] } }. `edits` are the terrain's changes against the map it
// was generated from (core/terrain.js), kept per region for placing and
// breaking blocks later. Where the player stands and their HP are not
// saved: a game always starts in the base, whole.
// Pure data in and out; the storage (localStorage in the page, a stand-in
// in tests) is handed in.
const saveKit = (() => {
    const KEY = 'blocky-rpg-save', VERSION = 1;
    const obj = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const whole = v => Number.isSafeInteger(v) && v >= 0;
    function fresh() { return { v: VERSION, bosses: {}, chests: {}, inventory: { gold: 0, items: {} }, edits: {} }; }
    // Whatever came out of storage, made safe: unknown bosses, items and
    // maps are dropped, counts must be whole and not negative. Anything
    // unreadable, or of another version, is a fresh save.
    function clean(data) {
        const out = fresh();
        if (!obj(data) || data.v !== VERSION) return out;
        if (obj(data.bosses)) for (const [kind, down] of Object.entries(data.bosses)) if (down === true && gameConfig.monsters[kind]?.boss) out.bosses[kind] = true;
        if (obj(data.chests)) for (const [key, open] of Object.entries(data.chests)) if (open === true && gameConfig.maps[key.split('/')[0]] && key.length < 80) out.chests[key] = true;
        const bag = data.inventory;
        if (obj(bag)) {
            if (whole(bag.gold)) out.inventory.gold = bag.gold;
            if (obj(bag.items)) for (const [id, n] of Object.entries(bag.items)) if (id !== 'gold' && gameConfig.items[id] && whole(n) && n > 0) out.inventory.items[id] = n;
        }
        if (obj(data.edits)) {
            for (const [region, list] of Object.entries(data.edits)) {
                if (!gameConfig.maps[region] || gameConfig.maps[region].duel || !Array.isArray(list)) continue;
                const ok = list.filter(e => Array.isArray(e) && e.length === 4 && whole(e[0]) && whole(e[1]) && Object.hasOwn(terrainKit.KIND, e[2]) && whole(e[3]));
                if (ok.length) out.edits[region] = ok.map(e => [...e]);
            }
        }
        return out;
    }
    // The save after time in world `sim`: its progress, and its region's
    // terrain changes.
    function merge(save, sim) {
        const out = clean(save), p = sim.progress;
        if (p) {
            out.bosses = { ...out.bosses, ...p.bosses };
            out.chests = { ...out.chests, ...p.chests };
            out.inventory = { gold: p.inventory.gold, items: { ...p.inventory.items } };
        }
        if (sim.region && !sim.duel) {
            const list = terrainKit.edits(sim.terrain);
            if (list.length) out.edits[sim.region] = list; else delete out.edits[sim.region];
        }
        return clean(out);
    }
    function load(storage) {
        let raw = null;
        try { raw = storage?.getItem(KEY); } catch (_) { /* Storage may be unavailable. */ }
        if (!raw) return fresh();
        try { return clean(JSON.parse(raw)); } catch (_) { return fresh(); }
    }
    function write(storage, save) {
        try { storage.setItem(KEY, JSON.stringify(clean(save))); return true; } catch (_) { return false; }
    }
    function erase(storage) {
        try { storage.removeItem(KEY); } catch (_) { /* Nothing to erase. */ }
        return fresh();
    }
    return { KEY, VERSION, fresh, clean, merge, load, write, erase };
})();
