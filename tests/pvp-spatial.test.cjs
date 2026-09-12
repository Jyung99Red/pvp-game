const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const files = ['core/data.js','core/effects.js','core/player.js','core/combat_resolver.js','core/spatial_combat.js','core/combat_gestures.js','pve/spatial_data.js','pve/spatial_engine.js','core/spatial_profiles.js','pvp/spatial_duel.js'];
function context(extra = {}) {
 const c = vm.createContext({console, ...extra});
 for(const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),c);
 return {c, ...vm.runInContext('({state,player,spatialDuel,spatialEngine,spatialProfiles,spatialCombat})',c)};
}
function setup(overrides = {}) {
 const t=context(), profile={...t.spatialProfiles.local(), guardDamageMultiplier:1, ...overrides};
 t.d=t.spatialDuel.create([profile,profile],()=>.99); t.D=t.spatialDuel; return t;
}
function step(t, seconds) { for(let n=0;n<Math.round(seconds*100);n++) t.D.step(t.d,.01); }
function close(t) { const [a,b]=t.d.sides.map(s=>s.player); a.x=b.x=180; a.y=230;b.y=170; a.facing=-Math.PI/2;b.facing=Math.PI/2; }
function input(t,i,type,channel,values) { return t.D.input(t.d,i,{type,channel,values,cancelled:false}); }
function light(t,i) { input(t,i,'press','move',[0,0]);input(t,i,'release','move'); }
function guard(t,i) { input(t,i,'press','guard',[0,0]); }
function skill(t,i,kind) { return t.D.input(t.d,i,{type:'skill',kind}); }

test('symmetric players share spatial tuning, equipment profiles and independent state',()=>{
 const t=setup({atk:90,def:12,motion:{move:1.2,turn:1.1,chargeMove:1,chargeTurn:1}});
 const [a,b]=t.d.sides;
 assert.equal(a.player.radius,b.player.radius);assert.equal(a.player.hp,a.player.maxHp);
 assert.equal(a.config.heavy.windup,.22);assert.equal(b.config.heavy.recovery,.6);
 assert.equal(a.config.fullCharge,2);assert.equal(a.config.motion.move,1.2);
 a.buffs.autoParry=1; assert.equal(b.buffs.autoParry,0);
 assert.equal(a.enemy,b.player);assert.equal(b.enemy,a.player);
 assert.throws(()=>t.D.create([{...t.d.profiles[0],atk:Infinity},t.d.profiles[1]]));
});
test('both actors obey reach; same-step lethal attacks trade and settle once as a draw',()=>{
 const t=setup({atk:100,maxHp:20,def:0});light(t,0);light(t,1);step(t,.12);
 assert.equal(t.d.sides[0].player.hp,20);assert.equal(t.d.sides[1].player.hp,20);
 step(t,.4);close(t);light(t,0);light(t,1);step(t,.12);
 assert.equal(t.d.result,'draw');assert.equal(t.d.sides[0].player.hp,0);assert.equal(t.d.sides[1].player.hp,0);
 assert.equal(t.d.events.filter(e=>e.type==='finished').length,1);
 const n=t.d.events.length;step(t,1);assert.equal(t.d.events.length,n);
 assert.equal(t.D.input(t.d,0,{type:'skill',kind:'heal'}),false);
});
test('guard, rear hit and parry work identically for host and guest; AP belongs to defender',()=>{
 for(const defender of [0,1]) for(const mode of ['parry','block','rear']) {
  const t=setup({atk:100,maxHp:500,def:0});close(t);guard(t,defender);step(t,mode==='parry'?.17:.5);
  const b=t.d.sides[defender],a=t.d.sides[1-defender];if(mode==='rear')b.player.facing+=Math.PI;
  const ap=b.player.ap; light(t,1-defender);step(t,.12);
  if(mode==='parry'){assert.equal(b.player.hp,500);assert.ok(a.player.hp<500);assert.ok(b.player.ap<ap);assert.equal(b.skillPoints,1);}
  else if(mode==='block'){assert.ok(b.player.hp<500);assert.ok(b.player.hp>470);assert.equal(b.player.ap,ap-1);}
  else {assert.equal(b.player.phase,'stunned');assert.equal(b.player.hp,470);assert.equal(b.action,null);}
 }
});
test('auto parry uses three SP, works from behind, but ordinary front guard preserves it',()=>{
 for(const front of [true,false]) {
  const t=setup({atk:100,maxHp:500,def:0});close(t);const b=t.d.sides[1];
  b.skillPoints=2;assert.equal(skill(t,1,'parry'),false);b.skillPoints=3;assert.equal(skill(t,1,'parry'),true);assert.equal(b.skillPoints,0);
  guard(t,1);step(t,.5);if(!front)b.player.facing+=Math.PI;light(t,0);step(t,.12);
  assert.equal(b.buffs.autoParry,front?1:0);assert.equal(b.player.hp,front?488:500);
 }
});
test('four-way gesture casts current skill rules; center cancels, full HP preserves queue and SP',()=>{
 const t=setup(), b=t.d.sides[1];b.skillPoints=3;
 light(t,1);light(t,1);assert.equal(b.queuedCommand.type,'light');assert.equal(skill(t,1,'heal'),false);assert.equal(b.queuedCommand.type,'light');
 step(t,1);b.player.hp-=20;
 input(t,1,'press','skill',[0,0]);input(t,1,'drag','skill',[0,-60,0,-60]);input(t,1,'drag','skill',[0,0,0,0]);input(t,1,'release','skill');
 assert.equal(b.skillPoints,3);
 input(t,1,'press','skill',[0,0]);input(t,1,'drag','skill',[0,-60,0,-60]);input(t,1,'release','skill');
 assert.equal(b.skillPoints,1);assert.equal(b.player.hp,b.player.maxHp);
});
test('queued skill spends only on execution, and full HP at execution cancels heal',()=>{
 for(const full of [true,false]) {
  const t=setup(),b=t.d.sides[0];b.skillPoints=3;b.player.hp-=20;light(t,0);
  assert.equal(skill(t,0,'heal'),true);assert.equal(b.skillPoints,3);
  if(full)b.player.hp=b.player.maxHp;
  step(t,.5);assert.equal(b.skillPoints,full?3:1);
 }
});
test('haste and full charge retain latest tuning without auto-fire or cross-player buffs',()=>{
 const t=setup(),b=t.d.sides[0];b.skillPoints=3;assert.equal(skill(t,0,'haste'),true);assert.equal(b.skillPoints,1);
 assert.equal(b.buffs.chargeHasteUntil,10);assert.equal(t.d.sides[1].buffs.chargeHasteUntil,0);
 input(t,0,'press','action',[0,0]);step(t,1);assert.ok(Math.abs(b.player.charge-1.5)<1e-6);
 step(t,2);assert.equal(b.player.charge,2);assert.equal(b.player.phase,'charging');
 input(t,0,'release','action');assert.equal(b.player.phase,'idle');
 b.skillPoints=3;assert.equal(skill(t,0,'full'),true);input(t,0,'press','action',[0,0]);assert.equal(b.player.charge,2);
 input(t,0,'release','action');assert.equal(b.buffs.instantCharge,false);assert.equal(b.skillPoints,1);
});
test('hit cancels only victims right input; held movement resumes and no tap leaks through stun',()=>{
 const t=setup({atk:10,maxHp:500});close(t);const b=t.d.sides[1];
 input(t,1,'press','move',[0,0]);input(t,1,'drag','move',[60,0,60,0]);input(t,1,'press','action',[0,0]);
 light(t,0);step(t,.12);assert.equal(b.player.phase,'stunned');assert.equal(b.action,null);assert.equal(b.move.suppressTap,true);
 const x=b.player.x;step(t,.2);assert.equal(b.player.x,x);step(t,.3);assert.ok(b.player.x>x);
 input(t,1,'release','move');assert.equal(b.stats.attacks,0);
});
test('snapshot restoration relinks queued held gestures and never aliases actors between matches',()=>{
 const t=setup();light(t,0);input(t,0,'press','guard',[0,0]);
 const d=t.D.create(t.d.profiles), snap=t.D.snapshot(t.d);t.D.restore(d,snap);
 assert.equal(t.D.validSnapshot(d,snap),true);
 const corrupt=JSON.parse(JSON.stringify(snap));corrupt.sides[0].player.x=-50;assert.equal(t.D.validSnapshot(d,corrupt),false);
 assert.equal(d.sides[0].queuedCommand.gesture,d.sides[0].guard);assert.equal(d.sides[0].enemy,d.sides[1].player);
 t.D.input(d,0,{type:'release',channel:'guard',cancelled:false});assert.equal(d.sides[0].queuedCommand,null);
 assert.ok(t.d.sides[0].guard);assert.notEqual(d.sides[0].player,t.d.sides[0].player);
});
test('SP caps, thorns double death, and bounded auto-face are symmetric',()=>{
 const t=setup({maxHp:20,atk:100,def:0,guardThorns:1});close(t);guard(t,1);step(t,.5);
 t.d.sides[1].player.hp=10;light(t,0);step(t,.12);assert.equal(t.d.result,'draw');
 const u=setup();const b=u.d.sides[1];b.controls.autoFace=true;b.player.facing=0;step(u,.01);assert.ok(Math.abs(b.player.facing)<=.08+1e-9);
 close(u);u.d.sides[0].skillPoints=3;light(u,0);step(u,.12);assert.equal(u.d.sides[0].skillPoints,3);
});

test('guest prediction cannot heal HP before the authoritative snapshot',()=>{
 const t=setup(),b=t.d.sides[1];b.skillPoints=3;b.player.hp-=30;
 const hp=b.player.hp;
 assert.equal(t.D.predictInput(t.d,1,{type:'skill',kind:'heal'}),true);
 assert.equal(b.player.hp,hp);
 b.skillPoints=3;light(t,1);t.D.predictInput(t.d,1,{type:'skill',kind:'heal'});
 for(let i=0;i<60;i++)t.D.predict(t.d,1,.01);
 assert.equal(b.player.hp,hp);assert.equal(b.skillPoints,1);
});

function pair() {
 let clock=100, next=0;const messages=[],rendered=[[],[]],results=[[],[]], peers=[];
 for(const [i,role] of ['host','guest'].entries()) {
  const loops=new Map(); const t=context({performance:{now:()=>clock},document:{hidden:false},
   requestAnimationFrame:fn=>{loops.set(++next,fn);return next;},cancelAnimationFrame:id=>loops.delete(id),
   pvpNet:{role,rtt:50,send:msg=>{messages.push({from:i,msg:JSON.parse(JSON.stringify(msg))});return true;}},
   ui:{switchTab(){}},uiPvp:{destroy(){},initFighters(){},clearInputs(){},updateFrame(e=[]){rendered[i].push(...e);},showResult(r){results[i].push(r);},hideResult(){},hideRematchRequest(){},showRematchRequest(){},showRematchWaiting(){},showDisconnectOverlay(){},settingsOpen(){return false;}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../pvp/pvp_logic.js'),'utf8'),t.c);t.logic=vm.runInContext('pvpLogic',t.c);t.loops=loops;peers.push(t);
 }
 const deliver=()=>{let guard=0;while(messages.length){assert.ok(guard++<1000);const {from,msg}=messages.shift();peers[1-from].logic.receiveMessage(msg);}};
 const frame=(ms=10,network=true)=>{clock+=ms;for(const t of peers){const callbacks=[...t.loops.values()];t.loops.clear();callbacks.forEach(fn=>fn(clock));}if(network)deliver();};
 peers[0].logic.startPVP('host',peers[1].spatialProfiles.local());deliver();for(let n=0;n<170;n++)frame();
 return {peers,messages,deliver,frame,rendered,results,get clock(){return clock;}};
}
function command(type,channel,values){return{type,channel,values,cancelled:false};}
test('two clients handshake/count down; local movement predicts before delivery; host alone changes HP',()=>{
 const p=pair(),[h,g]=p.peers;assert.ok(h.state.pvpBattle.ready&&g.state.pvpBattle.ready);
 assert.equal(h.logic.getCurrentBattleId(),g.logic.getCurrentBattleId());
 const x=g.state.pvpBattle.self.x;
 g.logic.input(command('press','move',[0,0]));g.logic.input(command('drag','move',[60,0,60,0]));
 p.frame(30,false);assert.ok(g.state.pvpBattle.self.x>x);assert.equal(h.state.pvpBattle.opponent.x,x);
 p.deliver();for(let n=0;n<20;n++)p.frame();assert.ok(h.state.pvpBattle.opponent.x>x);
 const before=h.state.pvpBattle.self.hp;
 h.logic.receiveMessage({msg:'duel_input',version:h.logic.VERSION,battleId:h.logic.getCurrentBattleId(),seq:3,command:{type:'teleport',hp:0,x:0}});
 assert.equal(h.state.pvpBattle.self.hp,before);
});
test('duplicate/wrong-session input and out-of-order snapshots cannot rewind state',()=>{
 const p=pair(),[h,g]=p.peers;
 const message={msg:'duel_input',version:h.logic.VERSION,battleId:h.logic.getCurrentBattleId(),seq:1,command:command('press','move',[0,0])};
 h.logic.receiveMessage(message);h.logic.receiveMessage({...message,seq:2,command:command('release','move')});
 const ap=h.state.pvpBattle.opponent.ap;h.logic.receiveMessage(message);assert.equal(h.state.pvpBattle.opponent.ap,ap);
 h.logic.receiveMessage({...message,seq:3,battleId:'previous',command:{type:'cancel'}});assert.equal(h.state.pvpBattle.opponent.phase,'attack');
 p.frame(60,false);const snap=p.messages.find(x=>x.msg.msg==='duel_snapshot').msg;p.deliver();
 const hp=g.state.pvpBattle.self.hp;snap.snapshot.sides[1].player.hp=1;g.logic.receiveMessage(snap);assert.equal(g.state.pvpBattle.self.hp,hp);
});
test('surrender has one authoritative result; both rematch orders reset HP/SP and reject previous match',()=>{
 for(const first of [0,1]) {
  const p=pair(),[h,g]=p.peers,old=h.logic.getCurrentBattleId();
  const saved=JSON.stringify(h.state.player);g.logic.surrender();p.deliver();assert.deepEqual(p.results,[['self'],['opponent']]);
  h.state.pvpBattle.duel.sides[0].skillPoints=3;
  p.peers[first].logic.requestRematch();p.deliver();p.peers[1-first].logic.acceptRematch();p.deliver();
  assert.notEqual(h.logic.getCurrentBattleId(),old);assert.equal(h.logic.getCurrentBattleId(),g.logic.getCurrentBattleId());
  assert.equal(h.state.pvpBattle.spatial.skillPoints,0);assert.equal(g.state.pvpBattle.spatial.skillPoints,0);
  assert.equal(h.state.pvpBattle.self.hp,h.state.pvpBattle.self.maxHp);
  h.logic.receiveMessage({msg:'duel_surrender',version:h.logic.VERSION,battleId:old});assert.equal(h.state.pvpBattle.active,true);
  assert.equal(JSON.stringify(h.state.player),saved);
 }
});
test('background or missing heartbeat aborts both sides without reward or automatic resume',()=>{
 const p=pair(),[h,g]=p.peers;vm.runInContext('document.hidden=true',g.c);p.frame();
 assert.equal(h.state.pvpBattle.active,false);assert.equal(g.state.pvpBattle.active,false);
 vm.runInContext('document.hidden=false',g.c);p.frame();assert.equal(g.state.pvpBattle.active,false);
 const q=pair();for(let n=0;n<510;n++)q.frame(10,false);assert.equal(q.peers[0].state.pvpBattle.active,false);assert.equal(q.peers[1].state.pvpBattle.active,false);
});
