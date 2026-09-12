const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
function setup() {
    const storage = new Map(), loops = new Map(); let next = 0;
    const c = vm.createContext({ console, performance: { now: () => 0 }, document: { hidden: false },
        requestAnimationFrame: fn => { loops.set(++next, fn); return next; }, cancelAnimationFrame: id => loops.delete(id),
        localStorage: { setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k) || null },
        ui: { switchTab() {}, updateBase() {} },
        uiPve: new Proxy({}, { get: () => () => {} }), fx: { log: new Proxy({}, { get: () => () => {} }) }
    });
    for (const file of ['core/data.js','core/effects.js','core/save.js','core/player.js','core/combat_resolver.js','core/arena_effects.js','core/spatial_combat.js','core/combat_gestures.js','pve/spatial_data.js','pve/spatial_engine.js','core/spatial_profiles.js','pve/pve_profiles.js','pve/pve_logic.js','core/tick.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
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

test('latest queued command replaces earlier input; cancelled move and pause do not drift',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t);
 const b=t.state.pveBattle.spatial,L=t.spatialEngine,x=b.player.x;
 L.press(b,'move'); L.release(b,'move');
 L.press(b,'move'); L.release(b,'move'); assert.equal(b.queuedCommand.type,'light');
 L.press(b,'guard'); assert.equal(b.queuedCommand.type,'guard');
 L.release(b,'guard'); assert.equal(b.queuedCommand,null);
 L.press(b,'move'); L.drag(b,'move',60,0); L.release(b,'move',true);
 seconds(t,.5); assert.equal(b.player.x,x); assert.equal(b.stats.attacks,1);
 L.press(b,'action'); L.drag(b,'action',60,0); t.pveLogic.pause(); t.pveLogic.resume();
 seconds(t,.5); assert.equal(b.stats.attacks,1); assert.equal(b.player.x,x);
});

test('heavy has .45 windup and .60 recovery before held movement resumes',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t);
 const b=t.state.pveBattle.spatial,L=t.spatialEngine;
 b.enemy.y=b.player.y-70; const hp=b.enemy.hp,x=b.player.x;
 L.press(b,'action'); seconds(t,.3); L.drag(b,'action',0,-60); L.release(b,'action');
 assert.equal(b.player.phase,'attack'); assert.equal(b.player.timer,.45);
 L.press(b,'move'); L.drag(b,'move',60,0);
 seconds(t,.2); assert.equal(b.enemy.hp,hp); assert.equal(b.player.x,x);
 seconds(t,.25); assert.ok(b.enemy.hp<hp); assert.equal(b.player.phase,'recover');
 seconds(t,.55); assert.equal(b.player.x,x);
 seconds(t,.1); assert.ok(b.player.x>x); assert.equal(b.stats.attacks,1);
});

test('every configured enemy validates; profiles apply enhancement, defense, timing, crit and AP',()=>{
 const t=setup();
 for(const id of Object.keys(t.content.enemies)) t.spatialEngine.create(t.pveProfiles.create(id,t.content.enemies[id]));
 const before=t.pveProfiles.create('goblin',t.content.enemies.goblin);
 t.state.player.equip.left='iron_sword'; t.state.inventory.enhance.iron_sword=5;
 const after=t.pveProfiles.create('goblin',t.content.enemies.goblin);
 assert.ok(after.heavy.chargeBonus>before.heavy.chargeBonus); assert.equal(after.chargeThreshold,.7);
 assert.equal(after.player.def,t.player.getStats().def); assert.equal(after.critChance,t.player.getCritChance());
 assert.equal(after.apMax,t.player.getApMax()); assert.equal(after.blockMultiplier,.4*t.player.getGuardDamageMultiplier());
 after.actions[0].range=1; assert.notEqual(t.pveProfiles.create('goblin',t.content.enemies.goblin).actions[0].range,1);
 assert.throws(()=>t.pveProfiles.create('missing',t.content.enemies.goblin));
 after.player.x=-1; assert.throws(()=>t.spatialEngine.create(after));
});

test('base, reward, next floor and retreat settle exactly once; HP and skill points carry',()=>{
 const t=setup(); t.state.player.currentHp=70; t.pveLogic.enterDungeon(); quiet(t);
 const id=t.state.pveBattle.battleId; t.pveLogic.enterDungeon(); assert.equal(t.state.pveBattle.battleId,id);
 t.state.pveBattle.skillPoints=2; victory(t);
 const exp=t.state.inventory.exp, gold=t.state.world.runGold; assert.ok(gold>0); assert.equal(t.state.resources.gold,0);
 t.pveLogic.advance(.1); assert.equal(t.state.inventory.exp,exp);
 t.pveLogic.continueNext(); const b=t.state.pveBattle; assert.equal(b.floor,2); assert.equal(b.skillPoints,2); assert.equal(b.player.hp,70);
 t.pveLogic.continueNext(); assert.equal(t.state.pveBattle.battleId,b.battleId);
 t.pveLogic.flee(); t.pveLogic.flee(); t.pveLogic.endFight(true);
 assert.equal(t.state.resources.gold,gold); assert.equal(t.state.world.runGold,0); assert.equal(t.state.world.status,'base');
 assert.equal(t.loops.size,0);
});

test('boss checkpoint advances; simultaneous environmental death loses run gold with no reward',()=>{
 const t=setup(); t.state.progress.checkpointFloor=9; t.pveLogic.enterDungeon(); assert.equal(t.state.pveBattle.enemyId,'elder_dragon');
 victory(t); assert.equal(t.state.progress.checkpointFloor,10);
 t.pveLogic.continueNext(); quiet(t); const exp=t.state.inventory.exp;
 t.state.pveBattle.arena=t.arenaEffects.create([{key:'burning_ground',startMs:0,intervalMs:10,pct:1}]);
 t.pveLogic.advance(.03);
 assert.equal(t.state.pveBattle.spatial.result,'defeat'); assert.equal(t.state.world.runGold,0); assert.equal(t.state.inventory.exp,exp);
 t.pveLogic.endFight(false); assert.ok(t.state.player.currentHp>0); t.pveLogic.enterDungeon(); assert.equal(t.state.pveBattle.floor,10); assert.equal(t.state.pveBattle.skillPoints,0);
});

test('simulation owns regen; paused battle has no HP or time drift; choice regen remains',()=>{
 const t=setup(); t.state.base.buildings.hotSpring=2; t.state.player.currentHp=50; t.pveLogic.enterDungeon(); quiet(t);
 t.tick.loop(); t.tick.loop(); assert.equal(t.state.player.currentHp,50);
 seconds(t,2); assert.equal(t.state.player.currentHp,53);
 t.pveLogic.pause(); const time=t.state.pveBattle.spatial.time;
 t.tick.loop(); seconds(t,2); assert.equal(t.state.player.currentHp,53); assert.equal(t.state.pveBattle.spatial.time,time);
 t.pveLogic.resume(); quiet(t); victory(t); t.tick.loop(); assert.equal(t.state.player.currentHp,55);
 t.c.document.hidden=true; t.tick.loop(); t.tick.loop(); assert.equal(t.state.player.currentHp,55);
});

test('all four skills retain costs; full charge awaits swipe, cancellation spends no AP',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); quiet(t); const b=t.state.pveBattle,e=b.spatial,L=t.spatialEngine;
 b.player.hp=30; b.skillPoints=3; t.pveLogic.useSkill('heal'); assert.equal(b.player.hp,60); assert.equal(t.state.player.currentHp,60); assert.equal(b.skillPoints,1);
 b.skillPoints=3; t.pveLogic.useSkill('haste'); assert.equal(b.skillPoints,1);
 L.press(e,'action'); seconds(t,.5); assert.ok(b.player.charge>.5); const q=b.player.charge;
 b.buffs.chargeHasteUntil=e.time; seconds(t,.1); assert.ok(b.player.charge>q);
 L.release(e,'action'); b.skillPoints=2; t.pveLogic.useSkill('full'); assert.equal(b.skillPoints,0);
 L.press(e,'action'); seconds(t,.3); assert.equal(b.player.charge,2); assert.equal(e.stats.attacks,0);
 L.release(e,'action'); assert.equal(b.player.ap,e.config.apMax); assert.equal(b.buffs.instantCharge,false);
 b.skillPoints=3; t.pveLogic.useSkill('parry'); assert.equal(b.buffs.autoParry,1); assert.equal(b.skillPoints,0);
});

test('auto parry checks spatial reach and protects from the rear without spending AP',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); const b=t.state.pveBattle,e=b.spatial;
 b.buffs.autoParry=1; b.enemy.phase='windup'; b.enemy.timer=.01; b.enemy.attack={kind:'circle',range:10,damage:20,active:.1,recovery:1};
 t.pveLogic.advance(.01); assert.equal(b.buffs.autoParry,1);
 b.enemy.phase='windup'; b.enemy.timer=.01; b.enemy.attack.range=300; b.player.phase='charging'; b.player.charge=0; b.player.chargeUpdatedAt=e.time; e.action={mode:'charge',start:e.time,dx:0,dy:0}; b.player.ap=0;
 t.pveLogic.advance(.01); assert.equal(b.buffs.autoParry,0); assert.equal(b.player.hp,b.player.maxHp); assert.equal(b.player.ap,0); assert.equal(b.player.phase,'charging');
});

test('thorns killing both sides is defeat; attacks cannot double-hit after settlement',()=>{
 const t=setup(); t.pveLogic.enterDungeon(); const b=t.state.pveBattle,e=b.spatial;
 e.config.guardThorns=1; b.player.hp=1; b.enemy.hp=1; b.player.phase='guard'; b.player.facing=-Math.PI/2; b.player.guardReadyAt=-10; e.guard={dx:0,dy:0};
 b.enemy.phase='windup'; b.enemy.timer=.01; b.enemy.attack={kind:'circle',range:300,damage:100,active:.1,recovery:1};
 t.pveLogic.advance(.01); assert.equal(e.result,'defeat'); assert.equal(b.player.hp,0); assert.equal(b.enemy.hp,0);
 const exp=t.state.inventory.exp; t.pveLogic.advance(.1); assert.equal(t.state.inventory.exp,exp);
});

test('30/60/120 FPS share simulation output and arena AP surge timing',()=>{
 const results=[];
 for(const fps of [30,60,120]) {
  const t=setup(); t.pveLogic.enterDungeon(); quiet(t); const b=t.state.pveBattle;
  b.player.ap=0; b.arena=t.arenaEffects.create([{key:'ap_surge',atMs:1000,apRateMult:2}]);
  seconds(t,3,fps); results.push([b.player.ap,b.spatial.time,b.arena.elapsedMs]);
 }
 assert.deepEqual(results[0],results[1]); assert.deepEqual(results[1],results[2]); assert.ok(results[0][0]>2);
});

test('v1 fixture round-trips equipment/progress and omits transient spatial combat',()=>{
 const t=setup(), key='idle_rpg_save_v1';
 t.storage.set(key,fs.readFileSync(path.join(__dirname,'fixtures/save-v1.json'),'utf8')); assert.equal(t.save.load(),true);
 t.pveLogic.enterDungeon(); t.save.save(); const saved=JSON.parse(t.storage.get(key));
 assert.equal(saved.resources.gold,123); assert.equal(saved.inventory.enhance.iron_sword,2); assert.equal(saved.progress.checkpointFloor,9);
 assert.equal(saved.pveBattle,undefined); assert.equal(saved.world,undefined);
 const fresh=setup(); fresh.storage.set(key,t.storage.get(key)); fresh.save.load(); assert.equal(fresh.state.world.status,'base'); assert.equal(fresh.state.pveBattle,null);
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
  const C=JSON.parse(JSON.stringify(config)); C.critChance=crit; C.chargeThreshold=threshold;
  const b=t.spatialEngine.create(C,()=>0); t.spatialEngine.start(b); b.enemy.y=b.player.y-70; b.enemy.phase='recover'; b.enemy.timer=100;
  t.spatialEngine.press(b,'action');
  for(let i=0;i<50;i++) t.spatialEngine.step(b,.01);
  assert.equal(b.action.mode,'charge');
  t.spatialEngine.drag(b,'action',0,-50); t.spatialEngine.release(b,'action');
  for(let i=0;i<50;i++) t.spatialEngine.step(b,.01);
  return t.spatialEngine.drainEvents(b).find(e=>e.type==='hit');
 }
 const normal=strike(0,.3), crit=strike(1,.3), slow=strike(0,.7);
 assert.ok(crit.crit); assert.ok(crit.damage>normal.damage); assert.ok(normal.damage>slow.damage);
});

test('boss enrage, explicit combo recovery and AP caps are active in the shared engine',()=>{
 const t=setup(), C=t.pveProfiles.create('elder_dragon',t.content.enemies.elder_dragon);
 C.ai.comboChance=1;
 const b=t.spatialEngine.create(C,()=>0); t.spatialEngine.start(b);
 b.enemy.hp=b.enemy.maxHp*.2; b.enemy.phase='active'; b.enemy.timer=.001; b.enemy.attack=C.actions[0];
 t.spatialEngine.step(b,.01);
 assert.equal(b.enemy.enraged,true); assert.equal(b.enemy.comboCount,1); assert.equal(b.enemy.timer,C.ai.comboDelay);
 const events=t.spatialEngine.drainEvents(b); assert.ok(events.some(e=>e.type==='enrage')); assert.ok(events.some(e=>e.type==='combo'));
 b.apRateMult=1000; b.enemy.phase='recover'; b.enemy.timer=100; b.player.ap=C.apMax-.1;
 t.spatialEngine.step(b,.01); assert.equal(b.player.ap,C.apMax); assert.ok(b.enemy.ap<=C.enemyApMax);
});


test('refreshing a defeat save returns alive at base without granting rewards',()=>{
 const t=setup(),key='idle_rpg_save_v1'; t.state.player.currentHp=0; t.save.save();
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
 victory(t);const exp=t.state.inventory.exp,gold=t.state.world.runGold;
 t.pveLogic.restore();t.pveLogic.resume();
 assert.equal(t.loops.size,0);assert.equal(t.state.inventory.exp,exp);assert.equal(t.state.world.runGold,gold);
});
