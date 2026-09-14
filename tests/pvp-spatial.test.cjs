const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const files = ['game_config.js','core/data.js','core/effects.js','core/player.js','core/combat_rules.js','core/spatial_combat.js','core/combat_gestures.js','pve/spatial_data.js','pve/spatial_engine.js','core/spatial_profiles.js','pvp/spatial_duel.js'];
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

test('weapon thresholds keep two seconds of damage growth and independent PVP charge limits',()=>{
 for(const threshold of [250,300,350]) {
  const t=context(), profile=t.spatialProfiles.fair();
  const d=t.spatialDuel.create([{...profile,chargeThresholdMs:threshold},{...profile,chargeThresholdMs:350}],()=>.99);
  const b=d.sides[0], T=threshold/1000;
  assert.equal(b.config.fullCharge,T+2); assert.equal(d.sides[1].config.fullCharge,2.35);
  for(const progress of [0,1,2]) {
   const actor=t.spatialEngine.create(b.config,()=>.99); t.spatialEngine.start(actor);
   t.spatialEngine.press(actor,'move');
   for(let i=0;i<5;i++) t.spatialEngine.advanceActor(actor,.05,()=>{});
   actor.player.charge=T+progress;
   t.spatialEngine.drag(actor,'move',50,0); t.spatialEngine.release(actor,'move');
   assert.equal(actor.player.attack.damage,Math.round(profile.atk*(.3+.8*progress/2)));
  }
 }
});

test('fair profile uses the shared rules, closer camera and independent enlarged arena',()=>{
 const t=context(), fair=t.spatialProfiles.fair(), d=t.spatialDuel.create([fair,fair]);
 const [a,b]=d.sides;
 assert.equal(fair.level,1); assert.equal(fair.maxHp,120); assert.equal(fair.atk,30); assert.equal(fair.def,8);
 assert.equal(a.config.width,570); assert.equal(a.config.height,630);
 assert.equal(a.config.camera.width,350); assert.equal(a.config.camera.height,390);
 assert.deepEqual([a.player.x,a.player.y],[285,405]); assert.deepEqual([b.player.x,b.player.y],[285,225]);
 assert.equal(a.config.skills.parry.cost,3); assert.notEqual(a.config.skills,b.config.skills);
});

test('PVP L walls share one layout, block center lines and stop continuous movement',()=>{
 const t=context(), fair=t.spatialProfiles.fair(), d=t.spatialDuel.create([fair,fair]), [a,b]=d.sides;
 const C=a.config, S=t.spatialCombat;
 assert.equal(C.wallLayoutId,'pvp-l-v1'); assert.equal(C.wallVersion,1); assert.equal(C.walls.length,4);
 assert.equal(S.segmentBlocked({x:180,y:280},{x:180,y:360},C.walls),true);
 assert.equal(S.hasLineOfSight({x:180,y:280},{x:180,y:360},C.walls),false);
 a.player.x=200; a.player.y=280; b.player.x=480; b.player.y=520;
 S.move(a.player,0,120,.5,C,b.player,C.walls);
 assert.ok(a.player.y <= 294 + 1e-6);
 const snap=t.spatialDuel.snapshot(d); assert.deepEqual(snap.visibility,[false,false]); assert.equal(t.spatialDuel.validSnapshot(d,snap),true);
 assert.equal(t.spatialDuel.validSnapshot(d,{...snap,wallLayoutId:'other'}),false);
});

test('PVP events carry wall visibility for display filtering',()=>{
 const t=setup(), [a,b]=t.d.sides;
 a.player.x=180; a.player.y=280; a.player.facing=Math.PI/2;
 b.player.x=180; b.player.y=360; b.player.facing=-Math.PI/2;
 light(t,0);
 const started=t.d.events.find(e=>e.type==='attack_started');
 assert.deepEqual(started.visibleTo,[false,false]);
});

test('PVP melee center-line cannot hit through an L wall',()=>{
 const t=setup({atk:100,def:0}), [a,b]=t.d.sides;
 a.player.x=180; a.player.y=280; a.player.facing=Math.PI/2;
 b.player.x=180; b.player.y=360; b.player.facing=-Math.PI/2;
 light(t,0); step(t,.12);
 assert.equal(b.player.hp,b.player.maxHp);
 assert.ok(t.d.events.some(e=>e.type==='miss' && e.blocked));
});

test('symmetric players share spatial tuning, equipment profiles and independent state',()=>{
 const t=setup({atk:90,def:12,motion:{move:1.2,turn:1.1,chargeMove:1,chargeTurn:1}});
 const [a,b]=t.d.sides;
 assert.equal(a.player.radius,b.player.radius);assert.equal(a.player.hp,a.player.maxHp);
 assert.equal(a.config.heavy.windup,.45);assert.equal(b.config.heavy.recovery,.6);
 assert.equal(a.config.fullCharge,2.3);assert.equal(a.config.motion.move,1.2);
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
  if(mode==='parry'){assert.equal(b.player.hp,500);assert.ok(a.player.hp<500);assert.ok(b.player.ap<ap);assert.equal(b.skillPoints,0);}
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
 input(t,0,'press','move',[0,0]);step(t,1.25);assert.ok(Math.abs(b.player.charge-1.5)<1e-6);
 step(t,2);assert.equal(b.player.charge,2.3);assert.equal(b.player.phase,'charging');
 input(t,0,'release','move');assert.equal(b.player.phase,'idle');
 b.skillPoints=3;assert.equal(skill(t,0,'full'),true);input(t,0,'press','move',[0,0]);step(t,.25);assert.equal(b.player.charge,2.3);
 input(t,0,'release','move');assert.equal(b.buffs.instantCharge,false);assert.equal(b.skillPoints,1);
});
test('hit cancels only victims right input; held movement resumes and no tap leaks through stun',()=>{
 const t=setup({atk:10,maxHp:500});close(t);const b=t.d.sides[1];
 input(t,1,'press','move',[0,0]);input(t,1,'drag','move',[60,0,60,0]);
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

test('combined charge survives snapshot replay and both sides release along their real facing',()=>{
 for(const side of [0,1]) {
  const t=setup(), b=t.d.sides[side];
  light(t,side);step(t,.12);b.player.timer=1;
  input(t,side,'press','move',[0,0]);step(t,.3);
  const snap=t.D.snapshot(t.d), restored=t.D.create(t.d.profiles);
  t.D.restore(restored,snap);const r=restored.sides[side];
  assert.equal(t.D.validSnapshot(restored,snap),true);
  assert.equal(r.queuedCommand.gesture,r.action);assert.equal(r.move.mode,'charge');
  t.D.input(restored,side,{type:'drag',channel:'move',values:[60,0,60,0]});
  assert.equal(r.action.dx,60);assert.equal(r.move.dx,60);
  const facing=r.player.facing;
  t.D.input(restored,side,{type:'release',channel:'move',cancelled:false});
  for(let i=0;i<71;i++)t.D.step(restored,.01);
  assert.equal(r.player.attack.facing,facing);assert.equal(r.stats.attacks,2);
  assert.equal(t.D.input(restored,side,{type:'press',channel:'action',values:[0,0]}),false);
 }
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
 assert.equal(b.player.hp,hp);assert.equal(b.skillPoints,3);
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
 return {peers,messages,deliver,frame,rendered,results,elapse(ms){clock+=ms;},get clock(){return clock;}};
}
function command(type,channel,values){return{type,channel,values,cancelled:false};}

test('guest snapshot between display frames does not advance arrival time twice',()=>{
 const p=pair(),[h,g]=p.peers;
 g.logic.input(command('press','move',[0,0]));g.logic.input(command('drag','move',[0,-60,0,-60]));p.deliver();
 p.frame(50,false);assert.ok(p.messages.some(m=>m.msg.msg==='duel_snapshot'));
 p.elapse(7);p.deliver();
 const before=g.state.pvpBattle.spatial.time, y=g.state.pvpBattle.self.y;
 p.frame(3,false);
 assert.ok(Math.abs(g.state.pvpBattle.spatial.time-before)<1e-9);
 assert.equal(g.state.pvpBattle.self.y,y);
 p.frame(7,false);
 assert.ok(Math.abs(g.state.pvpBattle.spatial.time-before-.01)<1e-9);
 assert.ok(g.state.pvpBattle.self.y<y);
 assert.equal(g.state.pvpBattle.self.hp,h.state.pvpBattle.opponent.hp);
});

function presentationFixture() {
 let clock=100,shown;
 const node={hidden:false,textContent:'',classList:{toggle(){}},setAttribute(){},addEventListener(){},querySelector(){return node;}};
 const t=context({performance:{now:()=>clock},document:{getElementById:()=>node,addEventListener(){}},
  window:{addEventListener(){}},AbortController,
  combatSettings:{attach:()=>({apply(){},destroy(){}})},combatInput:{attach:()=>({clear(){},destroy(){}})},
  uiSpatialBattle:{create:()=>({render:b=>{shown=b;},destroy(){},refresh(){}})},
  pvpLogic:{MODES:{fair:{label:'公平对决'}},input(){},cancelLocal(){},interrupt(){}}
 });
 const d=t.spatialDuel.create([t.spatialProfiles.fair(),t.spatialProfiles.fair()]);
 const b=t.state.pvpBattle={role:'guest',mode:'fair',duel:d,spatial:d.sides[1],self:d.sides[1].player,
  opponent:d.sides[0].player,visibility:[true,true],active:true,ready:true,countdown:0};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../pvp/ui_pvp.js'),'utf8'),t.c);
 const view=vm.runInContext('uiPvp',t.c);view.initFighters();
 return {t,b,view,render(ms=0){clock+=ms;view.updateFrame();return shown;}};
}

test('guest smooths only reconciliation error in a display copy, preserving immediate movement and HP',()=>{
 const {b,view,render}=presentationFixture(),old={...b.self};
 b.self.y+=8;b.self.facing+=.2;b.self.hp-=10;
 view.reconcileLocal(old);
 let shown=render();
 assert.equal(shown.player.y,old.y);assert.equal(shown.player.facing,old.facing);
 assert.equal(shown.player.hp,b.self.hp);assert.equal(shown.visibilityOrigin,b.self);
 assert.notEqual(shown.player,b.self);assert.equal(b.self.y,old.y+8);
 b.self.y-=2;shown=render();assert.equal(shown.player.y,old.y-2);
 const second={...b.self};b.self.y+=3;view.reconcileLocal(second);
 assert.equal(render().player.y,old.y-2);
 for(let n=0;n<50;n++)shown=render(16);
 assert.ok(Math.abs(shown.player.y-b.self.y)<.001);
 b.self.y+=100;view.reconcileLocal(second);assert.equal(render().player.y,b.self.y);
});

test('guest correction respects walls, resets on result/reinitialization, and never smooths host input',()=>{
 const {t,b,view,render}=presentationFixture();
 b.self.x=200;b.self.y=280;
 view.reconcileLocal({...b.self,y:320});
 const shown=render();assert.ok(shown.player.y<=294+1e-6);
 assert.equal(t.spatialCombat.canOccupy(shown.player,shown.player.x,shown.player.y,b.spatial.config,b.spatial.config.walls),true);
 assert.equal(b.self.y,280);
 b.duel.result='guest';view.reconcileLocal({...b.self,y:290});assert.equal(render().player.y,280);
 b.duel.result=null;view.reconcileLocal({...b.self,y:290});view.initFighters();assert.equal(render().player.y,280);
 b.role='host';view.reconcileLocal({...b.self,y:290});assert.equal(render().player.y,280);
});
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
