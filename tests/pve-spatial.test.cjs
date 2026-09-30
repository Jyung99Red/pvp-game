const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function setup() {
    const storage = new Map(), loops = new Map(); let next = 0;
    const c = vm.createContext({ console, performance: { now: () => 0 }, document: { hidden: false },
        requestAnimationFrame: fn => { loops.set(++next, fn); return next; }, cancelAnimationFrame: id => loops.delete(id),
        localStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k) || null },
        ui: { switchTab() {}, updateBase() {}, log() {} },
        uiAdventure: new Proxy({}, { get: () => () => {} }), fx: { log: new Proxy({}, { get: () => () => {} }) }
    });
    for (const file of ['game_config.js','core/data.js','core/effects.js','core/save.js','core/player.js','core/combat_rules.js','core/arena_effects.js','core/spatial_combat.js','core/combat_gestures.js','pve/spatial_data.js','pve/spatial_engine.js','core/spatial_profiles.js','pve/pve_profiles.js','pve/pve_logic.js','core/tick.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
    const objects = vm.runInContext('({state,content,player,save,spatialEngine,pveProfiles,pveLogic,tick,arenaEffects})',c);
    objects.pveLogic.setRandom(() => .5);
    return {...objects, storage, loops, c};
}
function seconds(t, s, fps=60) { for(let i=0;i<Math.round(s*fps);i++) t.pveLogic.advance(1/fps); }
function quiet(t) { t.state.pveBattle.enemy.phase='recover'; t.state.pveBattle.enemy.timer=1000; }
function victory(t) { t.state.pveBattle.enemy.hp=0; t.pveLogic.advance(.01); }

test('left movement held through light attack resumes after recovery and stops on release',()=>{
 for (const delay of [0, .15]) {
  const t=setup(); t.pveLogic.enterDungeon(); quiet(t);
  const b=t.state.pveBattle.spatial, L=t.spatialEngine, x=b.player.x;
  L.press(b,'move'); L.release(b,'move'); seconds(t,delay);
  assert.equal(L.press(b,'move'),true); L.drag(b,'move',60,0);
  seconds(t,.1); assert.equal(b.player.x,x);
  seconds(t,.4); assert.ok(b.player.x>x); assert.equal(b.stats.attacks,1);
  L.release(b,'move'); const stopped=b.player.x;
  seconds(t,.2); assert.equal(b.player.x,stopped); assert.equal(b.stats.attacks,1);
 }
});

test('presses before the swing ends are dropped, guard cuts a buffered recovery; cancelled move and pause do not drift',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t);
 const b=t.state.pveBattle.spatial,L=t.spatialEngine,x=b.player.x;
 L.press(b,'move'); L.release(b,'move');
 L.press(b,'move'); L.release(b,'move'); assert.equal(b.queuedCommand,null,'a press during the windup is dropped');
 seconds(t,.2); assert.equal(b.player.phase,'recover');
 L.press(b,'move'); L.release(b,'move'); assert.equal(b.queuedCommand.type,'tap');
 L.press(b,'guard'); assert.equal(b.player.phase,'guard_start'); assert.equal(b.queuedCommand,null);
 L.release(b,'guard'); assert.equal(b.player.phase,'idle');
 L.press(b,'move'); L.drag(b,'move',60,0); L.release(b,'move',true);
 seconds(t,.5); assert.equal(b.player.x,x); assert.equal(b.stats.attacks,1);
 L.press(b,'move'); L.drag(b,'move',60,0); t.pveLogic.pause(); t.pveLogic.resume();
 seconds(t,.5); assert.equal(b.stats.attacks,1); assert.equal(b.player.x,x);
});

test('charged slash has .45 windup, .12 swing and .60 recovery before held movement resumes',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t);
 const b=t.state.pveBattle.spatial,L=t.spatialEngine;
 b.enemy.y=b.player.y-70; const hp=b.enemy.hp,x=b.player.x;
 L.press(b,'move'); seconds(t,.3); L.drag(b,'move',0,-60); L.release(b,'move');
 assert.equal(b.player.phase,'attack'); assert.equal(b.player.timer,.45);
 L.press(b,'move'); L.drag(b,'move',60,0);
 seconds(t,.2); assert.equal(b.enemy.hp,hp); assert.equal(b.player.x,x);
 seconds(t,.25); assert.equal(b.enemy.hp,hp); assert.equal(b.player.phase,'swing');
 // The hit's hitstop holds the swing for .06s on top of its .12s.
 seconds(t,.2); assert.ok(b.enemy.hp<hp); assert.equal(b.player.phase,'recover');
 seconds(t,.53); assert.equal(b.player.x,x);
 seconds(t,.1); assert.ok(b.player.x>x); assert.equal(b.stats.attacks,1);
});

test('every configured enemy validates; profiles apply enhancement, defense, timing, crit and guard bar',()=>{
 const t=setup();
 for(const id of Object.keys(t.content.enemies)) t.spatialEngine.create(t.pveProfiles.create(id,t.content.enemies[id]));
 const before=t.pveProfiles.create('goblin',t.content.enemies.goblin);
 t.state.player.equip.left='iron_sword'; t.state.inventory.enhance.iron_sword=5;
 const after=t.pveProfiles.create('goblin',t.content.enemies.goblin);
  assert.ok(after.atk>before.atk); assert.equal(after.chargeThreshold,.35);
 assert.equal(after.player.def,t.player.getStats().def); assert.equal(after.critChance,t.player.getCritChance());
 assert.equal(after.guardMax,100); assert.equal(after.blockMultiplier,.4*t.player.getGuardDamageMultiplier());
 t.state.player.equip.accessory='vigor_ring'; assert.equal(t.pveProfiles.create('goblin',t.content.enemies.goblin).guardMax,125);
 after.actions[0].range=1; assert.notEqual(t.pveProfiles.create('goblin',t.content.enemies.goblin).actions[0].range,1);
 assert.throws(()=>t.pveProfiles.create('missing',t.content.enemies.goblin));
 after.player.x=-1; assert.throws(()=>t.spatialEngine.create(after));
});

test('area travel bypasses encounters and normal rewards bank immediately',()=>{
 const t=setup(); assert.equal(t.pveLogic.travel('b'),true); assert.equal(t.state.progress.currentRegionId,'b');
 assert.equal(t.pveLogic.travel('c'),true); assert.equal(t.state.progress.currentRegionId,'c');
 assert.equal(t.pveLogic.travel('b'),true); assert.equal(t.state.progress.currentRegionId,'b');
 assert.equal(t.pveLogic.startEncounter('goblin'),true); quiet(t); victory(t);
 const exp=t.state.inventory.exp, gold=t.state.resources.gold; assert.ok(exp>0); assert.ok(gold>0);
 t.pveLogic.advance(.1); assert.equal(t.state.inventory.exp,exp); assert.equal(t.state.resources.gold,gold);
 // A victory retires the fight on the spot -- there is no result screen to sit
 // on, so the region is already handed back by the time `advance` returns.
 assert.equal(t.state.pveBattle.ended,true); assert.equal(t.state.pveBattle.active,false);
 assert.equal(t.pveLogic.returnToRegion(),false, 'nothing left to return from');
 assert.equal(t.state.world.status,'exploring');
 assert.equal(t.loops.size,0);
});

test('C boss unlocks D once and never becomes a valid encounter again',()=>{
 const t=setup(); t.pveLogic.travel('b'); t.pveLogic.travel('c');
 assert.equal(t.pveLogic.travel('d'),false); assert.equal(t.pveLogic.isRegionUnlocked('d'),false);
 assert.equal(t.pveLogic.startEncounter('elder_dragon'),true); victory(t);
 assert.equal(t.pveLogic.isBossDefeated('elder_dragon'),true); assert.equal(t.pveLogic.isRegionUnlocked('d'),true);
 t.pveLogic.returnToRegion(); assert.equal(t.pveLogic.startEncounter('elder_dragon'),false);
 assert.equal(t.pveLogic.travel('d'),true); assert.equal(t.state.progress.currentRegionId,'d');
});

test('simulation owns regen; paused battle has no HP or time drift; a retired fight gives it back',()=>{
 const t=setup(); t.state.base.buildings.hotSpring=2; t.state.player.currentHp=50; t.pveLogic.enterDungeon(); quiet(t);
 t.tick.loop(); t.tick.loop(); assert.equal(t.state.player.currentHp,50);
 seconds(t,2); assert.equal(t.state.player.currentHp,53);
 t.pveLogic.pause(); const time=t.state.pveBattle.spatial.time;
 t.tick.loop(); seconds(t,2); assert.equal(t.state.player.currentHp,53); assert.equal(t.state.pveBattle.spatial.time,time);
 // A victory retires the fight by itself, so the tick owns regen again -- and
 // the hot spring is a BASE facility: out in the field it heals nothing, which
 // is exactly the status this leaves behind.
 t.pveLogic.resume(); quiet(t); victory(t);
 assert.equal(t.state.pveBattle.active,false); assert.equal(t.state.world.status,'exploring');
 const walk=t.state.player.currentHp;
 t.tick.loop(); t.tick.loop();
 assert.ok(t.state.player.currentHp - walk <= 1, 'the spring must not reach past the base');
});

test('all four skills retain costs; a charge always fires and full charge is spent once',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t); const b=t.state.pveBattle,e=b.spatial,L=t.spatialEngine;
 b.player.hp=30; b.skillPoints=3; t.pveLogic.useSkill('heal'); assert.equal(b.player.hp,60); assert.equal(t.state.player.currentHp,60); assert.equal(b.skillPoints,1);
 b.skillPoints=3; t.pveLogic.useSkill('haste'); assert.equal(b.skillPoints,1);
 L.press(e,'move'); seconds(t,.75); assert.ok(b.player.charge>.5); const q=b.player.charge;
 b.buffs.chargeHasteUntil=e.time; seconds(t,.1); assert.ok(b.player.charge>q);
 L.release(e,'move'); assert.equal(e.stats.attacks,1); seconds(t,1.3);
 b.skillPoints=2; t.pveLogic.useSkill('full'); assert.equal(b.skillPoints,0);
 L.press(e,'move'); seconds(t,.3); assert.equal(b.player.charge,2.3); assert.equal(e.stats.attacks,1);
 L.release(e,'move'); assert.equal(b.buffs.instantCharge,false); assert.equal(e.stats.attacks,2);
 seconds(t,1.3); b.skillPoints=3; t.pveLogic.useSkill('parry'); assert.equal(b.buffs.autoParry,1); assert.equal(b.skillPoints,0);
});

test('auto parry checks spatial reach and protects from the rear, even with the guard bar locked',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); const b=t.state.pveBattle,e=b.spatial;
 b.buffs.autoParry=1; b.enemy.phase='windup'; b.enemy.timer=.01; b.enemy.attack={kind:'circle',range:10,damage:20,active:.1,recovery:1};
 t.pveLogic.advance(.01); assert.equal(b.buffs.autoParry,1);
 b.enemy.phase='windup'; b.enemy.timer=.01; b.enemy.attack.range=300; b.player.phase='charging'; b.player.charge=0; b.player.chargeUpdatedAt=e.time; e.action={mode:'charge',start:e.time,dx:0,dy:0}; b.player.guardBar=0; b.player.guardLocked=true;
 t.pveLogic.advance(.01); assert.equal(b.buffs.autoParry,0); assert.equal(b.player.hp,b.player.maxHp); assert.equal(b.player.guardLocked,true); assert.equal(b.player.phase,'charging');
});

test('thorns killing both sides is defeat; attacks cannot double-hit after settlement',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); const b=t.state.pveBattle,e=b.spatial;
 e.config.guardThorns=1; b.player.hp=1; b.enemy.hp=1; b.player.phase='guard'; b.player.facing=-Math.PI/2; b.player.guardReadyAt=-10; e.guard={dx:0,dy:0};
 b.enemy.phase='windup'; b.enemy.timer=.01; b.enemy.attack={kind:'circle',range:300,damage:100,active:.1,recovery:1};
 t.pveLogic.advance(.01); assert.equal(e.result,'defeat'); assert.equal(b.player.hp,0); assert.equal(b.enemy.hp,0);
 const exp=t.state.inventory.exp; t.pveLogic.advance(.1); assert.equal(t.state.inventory.exp,exp);
});

test('30/60/120 FPS share simulation output and arena AP surge timing on the enemy',()=>{
 const results=[];
 for(const fps of [30,60,120]) {
  const t=setup(); t.pveLogic.enterDungeon(); quiet(t); const b=t.state.pveBattle;
  b.enemy.ap=0; b.player.guardBar=0; b.arena=t.arenaEffects.create([{key:'ap_surge',atMs:1000,apRateMult:2}]);
  seconds(t,3,fps); results.push([b.enemy.ap,b.player.guardBar,b.spatial.time,b.arena.elapsedMs]);
 }
 assert.deepEqual(results[0],results[1]); assert.deepEqual(results[1],results[2]); assert.ok(results[0][0]>2);
});

test('v1 fixture migrates to persistent area progress and omits transient combat',()=>{
 const t=setup(), legacyKey='idle_rpg_save_v1', key='idle_rpg_save_v2';
 t.storage.set(legacyKey,fs.readFileSync(path.join(__dirname,'fixtures/save-v1.json'),'utf8')); assert.equal(t.save.load(),true);
 t.pveLogic.travel('b'); t.pveLogic.travel('c'); t.pveLogic.startEncounter('elder_dragon'); victory(t); t.save.save(); const saved=JSON.parse(t.storage.get(key));
 assert.equal(saved.v,2); assert.equal(saved.resources.gold>123,true); assert.equal(saved.inventory.enhance.iron_sword,2);
 assert.equal(saved.progress.currentRegionId,'c'); assert.equal(saved.progress.defeatedBosses.elder_dragon,true); assert.equal(saved.progress.unlockedRegions.d,true);
 assert.equal(saved.pveBattle,undefined); assert.equal(saved.world,undefined);
 const fresh=setup(); fresh.storage.set(key,t.storage.get(key)); fresh.save.load(); assert.equal(fresh.state.world.status,'base'); assert.equal(fresh.state.pveBattle,null);
 assert.equal(fresh.state.progress.currentRegionId,'c'); assert.equal(fresh.state.progress.defeatedBosses.elder_dragon,true);
});

test('wall contact does not push a stationary guard or overlap actors',()=>{
 const t=setup(),S=vm.runInContext('spatialCombat',t.c);
 const p={x:12,y:12,radius:12},e={x:47,y:12,radius:23};
 for(let i=0;i<50;i++) S.move(e,-47,-47,.01,{width:360,height:400},p);
 assert.ok(S.distance(p,e)>=35-1e-7); assert.equal(p.x,12); assert.equal(p.y,12);
});

test('crit changes actual damage and equipment threshold changes heavy yield without changing gestures',()=>{
 const t=setup(); const config=t.pveProfiles.create('goblin',t.content.enemies.goblin);
 function strike(crit, threshold) {
  const C=JSON.parse(JSON.stringify(config)); C.critChance=crit; C.chargeThreshold=threshold; C.fullCharge=threshold+2;
  const b=t.spatialEngine.create(C,()=>0); t.spatialEngine.start(b); b.enemy.y=b.player.y-70; b.enemy.phase='recover'; b.enemy.timer=100;
  t.spatialEngine.press(b,'move');
  for(let i=0;i<75;i++) t.spatialEngine.step(b,.01);
  assert.equal(b.action.mode,'charge');
  t.spatialEngine.drag(b,'move',0,-50); t.spatialEngine.release(b,'move');
  for(let i=0;i<50;i++) t.spatialEngine.step(b,.01);
  return t.spatialEngine.drainEvents(b).find(e=>e.type==='hit');
 }
 const normal=strike(0,.3), crit=strike(1,.3), slow=strike(0,.7);
 assert.ok(crit.crit); assert.ok(crit.damage>normal.damage); assert.ok(normal.damage>slow.damage);
});

test('boss enrage, explicit combo recovery, enemy AP and guard bar caps are active in the shared engine',()=>{
 const t=setup(), C=t.pveProfiles.create('elder_dragon',t.content.enemies.elder_dragon);
 C.ai.comboChance=1;
 const b=t.spatialEngine.create(C,()=>0); t.spatialEngine.start(b);
 b.enemy.hp=b.enemy.maxHp*.2; b.enemy.phase='active'; b.enemy.timer=.001; b.enemy.attack=C.actions[0];
 t.spatialEngine.step(b,.01);
 assert.equal(b.enemy.enraged,true); assert.equal(b.enemy.comboCount,1); assert.equal(b.enemy.timer,C.ai.comboDelay);
 const events=t.spatialEngine.drainEvents(b); assert.ok(events.some(e=>e.type==='enrage')); assert.ok(events.some(e=>e.type==='combo'));
 b.apRateMult=1000; b.enemy.phase='recover'; b.enemy.timer=100; b.enemy.ap=C.enemyApMax-.1; b.player.guardBar=C.guardMax-.1;
 t.spatialEngine.step(b,.01); assert.equal(b.enemy.ap,C.enemyApMax); assert.equal(b.player.guardBar,C.guardMax);
});

test('focus drives time-based SP recovery without hit rewards',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t); const b=t.state.pveBattle;
 seconds(t,2.9); assert.equal(b.skillPoints,0);
 seconds(t,.2); assert.equal(b.skillPoints,1); assert.ok(b.skillProgress<.1);
 t.state.player.baseStats.focus=20; const faster=t.pveProfiles.create('goblin',t.content.enemies.goblin);
 assert.equal(faster.apRegen,undefined); assert.equal(faster.spRegen,2/3);
});

test('wolf dash locks direction, travels a real path and hits at most once',()=>{
 const t=setup(), C=t.pveProfiles.create('wolf',t.content.enemies.wolf), b=t.spatialEngine.create(C,()=>0), S=t.spatialEngine;
 assert.equal(C.actions[1].kind,'dash'); assert.ok(Math.abs(C.actions[1].windup-1.15)<1e-8); assert.ok(Math.abs(C.actions[1].recovery-1.35)<1e-8); assert.equal(C.actions[1].dash.speed,280);
 S.start(b); const e=b.enemy,p=b.player; e.x=p.x=180; e.y=180; p.y=270; p.facing=-Math.PI/2;
 e.phase='windup'; e.timer=.01; e.attack=C.actions[1]; e.facing=Math.PI/2;
 S.step(b,.01); assert.equal(e.phase,'dash'); const before=e.y;
 for(let i=0;i<5;i++) S.step(b,.05); const events=S.drainEvents(b);
 assert.ok(e.y>before); assert.ok(events.some(x=>x.type==='dash_started')); assert.equal(events.filter(x=>x.type==='hit' && x.side==='enemy').length,1); assert.ok(p.hp<p.maxHp);
 const hp=p.hp; for(let i=0;i<5;i++) S.step(b,.05); assert.equal(p.hp,hp);
});

test('dash contact stops immediately for early/late blocks and parries, preserving stagger',()=>{
 for (const x of [180,250]) for (const defense of ['block','parry','auto','stagger']) {
  const t=setup(), C=t.pveProfiles.create('wolf',t.content.enemies.wolf), S=t.spatialEngine;
  C.parryWindow=1;
  const b=S.create(C,()=>.99); S.start(b); const e=b.enemy,p=b.player;
  Object.assign(e,{x:100,y:250,facing:0,phase:'dash',attack:C.actions[1],dashFacing:0,dashRemaining:150,dashHit:false});
  Object.assign(p,{x,y:250,facing:Math.PI,phase:defense==='auto'?'idle':'guard',guardReadyAt:defense==='block'?-100:0});
  if(defense==='auto') b.buffs.autoParry=1;
  if(defense==='stagger') e.stagger=C.stagger.threshold-C.stagger.parry;
  for(let i=0;i<100 && !e.dashHit;i++) S.step(b,.01);
  assert.equal(e.dashHit,true); assert.equal(e.phase,defense==='stagger'?'stagger':'recover');
  const stopped=e.x; S.step(b,.05); assert.equal(e.x,stopped); assert.ok(e.x<p.x);
  const events=S.drainEvents(b); assert.equal(events.filter(v=>v.type==='block'||v.type==='parry').length,1);
 }
});

test('diagonal dash stops at wall and boundary contact without sliding',()=>{
 for(const wall of [false,true]) {
  const t=setup(), C=t.pveProfiles.create('wolf',t.content.enemies.wolf);
  const b=t.spatialEngine.create(C,()=>.99), e=b.enemy,p=b.player;
  if(wall) b.config.walls=[{x:200,y:150,width:10,height:250}];
  Object.assign(e,{x:wall?150:450,y:250,facing:Math.PI/4,phase:'dash',attack:C.actions[1],dashFacing:Math.PI/4,dashRemaining:150,dashHit:false});
  Object.assign(p,{x:50,y:50}); const start={x:e.x,y:e.y}; t.spatialEngine.start(b);
  for(let i=0;i<100 && e.phase==='dash';i++) t.spatialEngine.step(b,.01);
  assert.equal(e.phase,'recover'); assert.ok(Math.abs((e.x-start.x)-(e.y-start.y))<1e-5);
  assert.ok(Math.abs(e.x-((wall?200:C.width)-e.radius))<1e-5);
 }
});


test('refreshing a defeat save returns alive at base without granting rewards',()=>{
 const t=setup(),key='idle_rpg_save_v2'; t.state.player.currentHp=0; t.save.save();
 const fresh=setup(); fresh.storage.set(key,t.storage.get(key)); fresh.save.load();
 assert.equal(fresh.state.player.currentHp,10); assert.equal(fresh.state.world.status,'base');
 assert.equal(fresh.state.resources.gold,0); assert.equal(fresh.state.inventory.exp,0);
 fresh.pveLogic.enterDungeon(); assert.equal(fresh.state.pveBattle.player.hp,10);
});

test('full-HP heal never spends SP or replaces a queued action; parry requires 3 SP',()=>{
 const t=setup();t.pveLogic.enterDungeon();quiet(t);
 const b=t.state.pveBattle,e=b.spatial,L=t.spatialEngine;
 b.skillPoints=3;L.press(e,'move');L.release(e,'move');L.press(e,'guard');
 const queued=e.queuedCommand;
 t.pveLogic.useSkill('heal');assert.equal(b.skillPoints,3);assert.equal(e.queuedCommand,queued);
 L.release(e,'guard');seconds(t,.5);
 b.skillPoints=2;t.pveLogic.useSkill('parry');assert.equal(b.buffs.autoParry,0);assert.equal(b.skillPoints,2);
 b.skillPoints=3;t.pveLogic.useSkill('parry');assert.equal(b.buffs.autoParry,1);assert.equal(b.skillPoints,0);
});

test('queued heal charges only at execution and cancels for free if HP becomes full',()=>{
 for(const fillBeforeExecution of [false,true]) {
  const t=setup();t.pveLogic.enterDungeon();quiet(t);
  const b=t.state.pveBattle,e=b.spatial,L=t.spatialEngine;
  b.player.hp=50;b.skillPoints=3;
  L.press(e,'move');L.release(e,'move');t.pveLogic.useSkill('heal');
  assert.equal(b.skillPoints,3);assert.equal(e.queuedCommand.kind,'heal');
  if(fillBeforeExecution)b.player.hp=b.player.maxHp;
  seconds(t,.5);
  assert.equal(b.skillPoints,fillBeforeExecution?3:1);
  assert.equal(b.player.hp,fillBeforeExecution?b.player.maxHp:80);
 }
});

test('foreground restore preserves battle and rewards and resume schedules one loop',()=>{
 const t=setup();t.pveLogic.enterDungeon();quiet(t);seconds(t,.2);
 const b=t.state.pveBattle,time=b.spatial.time;
 t.pveLogic.restore();t.pveLogic.restore();assert.equal(t.loops.size,0);
 assert.equal(t.state.pveBattle,b);assert.equal(b.spatial.time,time);
 t.pveLogic.resume();t.pveLogic.resume();assert.equal(t.loops.size,1);
 victory(t);const exp=t.state.inventory.exp,gold=t.state.resources.gold;
 t.pveLogic.restore();t.pveLogic.resume();
 assert.equal(t.loops.size,0);assert.equal(t.state.inventory.exp,exp);assert.equal(t.state.resources.gold,gold);
});

test('region and enemy profiles build for every authored region and monster',()=>{
 const t=setup(), zoom=vm.runInContext('gameConfig.adventure.camera.zoom',t.c);
 for(const def of Object.values(t.content.regions)){
  const r=t.pveProfiles.region(def);
  assert.equal(r.width,def.map.width);assert.equal(r.height,def.map.height);
  assert.equal(r.solo,true);assert.equal(r.camera.zoom,zoom);
  const walk=t.spatialEngine.create(r);
  assert.equal(walk.enemy,null);
  t.spatialEngine.start(walk);
  const x=walk.player.x,y=walk.player.y;
  for(let i=0;i<60;i++) t.spatialEngine.advanceActor(walk,1/60);
  assert.equal(walk.player.x,x);assert.equal(walk.player.y,y);   // no input, no drift
  assert.equal(walk.skillPoints,0);                              // walking banks no SP
  const radius=m=>m.boss?25:16;
  for(const m of def.map.monsters||[]){
   const C=t.pveProfiles.enemy(def,m.enemyId,t.content.enemies[m.enemyId],{radius:radius(m),speed:m.speed});
   assert.equal(C.width,def.map.width);assert.equal(C.height,def.map.height);
   assert.equal(C.ai.speed,m.speed);assert.equal(C.enemy.radius,radius(m));
   // Combat starts wherever the bodies already stand, so a fully overlapping
   // pair has to be resolved by separation rather than refused.
   C.player.x=m.x;C.player.y=m.y;C.enemy.x=m.x;C.enemy.y=m.y;
   const b=t.spatialEngine.create(C);
   assert.ok(Math.hypot(b.player.x-b.enemy.x,b.player.y-b.enemy.y)>=b.player.radius+b.enemy.radius-1e-6,
     `${m.id} failed to separate`);
   assert.equal(C.enemy.x,m.x);assert.equal(C.enemy.y,m.y);   // create must not move the caller's actors
  }
 }
});
