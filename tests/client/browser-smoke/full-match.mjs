import assert from 'node:assert/strict';
export function fullMatchOptions(args=process.argv.slice(2)) {
  if(args.some(arg=>arg!=='--full-match')||args.length>1)throw new Error('Only --full-match is supported');
  return {enabled:args.includes('--full-match'),timeoutMs:60*60*1000};
}
// Observe only, before client boot: no steps, commands, state edits or virtual clock.
export function installFullMatchProbe() {
  const native=window.requestAnimationFrame.bind(window);
  const result={initial:null,terminal:null,samples:[],error:null,startedAt:new Date().toISOString(),finishedAt:null,visibilityChanges:[]};
  window.__mobaFullMatch=result;
  const brief=s=>({tick:s.tick,timeSeconds:s.timeSeconds,status:s.status,winner:s.winner,endReason:s.endReason,contentVersion:s.contentVersion,bases:s.entities.filter(e=>e.structureKind==='base').map(e=>({team:e.team,alive:e.alive,hp:e.hp}))});
  document.addEventListener('visibilitychange',()=>{
    if(result.terminal)return;
    result.visibilityChanges.push({hidden:document.hidden,at:performance.now()});
    if(document.hidden)result.error='Match page became hidden';
  });
  let previous=null;
  window.requestAnimationFrame=callback=>native(now=>{
    if(result.terminal||result.error)return callback(now);
    const before=window.mobaClient?.snapshot();
    if(before&&!result.initial)result.initial=brief(before);
    const start=performance.now();
    try {callback(now);} finally {
      const cost=performance.now()-start;
      if(before&&!result.terminal&&!result.error){
        const after=window.mobaClient?.snapshot();
        if(!after)result.error='Client disappeared during match';
        else if(document.hidden)result.error='Match page became hidden';
        else if(document.querySelector('dialog[open]'))result.error='Match paused by dialog';
        else if(result.samples.length>=1000000)result.error='Frame sample limit reached';
        else {
          result.samples.push({atMs:now,tick:after.tick,timeSeconds:after.timeSeconds,callbackMs:cost,intervalMs:previous===null?null:now-previous});
          previous=now;
          if(after.status!=='running'){result.terminal=brief(after);result.finishedAt=new Date().toISOString();}
        }
      }
    }
  });
}
function distribution(values) {
  assert.ok(values.length>0,'Missing frame timing samples');
  assert.ok(values.every(v=>Number.isFinite(v)&&v>=0),'Invalid frame timing');
  const sorted=[...values].sort((a,b)=>a-b),percentile=p=>sorted[Math.ceil(sorted.length*p)-1];
  return {count:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),maxMs:sorted.at(-1),over33ms:values.filter(v=>v>33.333).length};
}
export function summarizeFullMatch(result) {
  assert.ok(result&&!result.error,result?.error??'Missing full-match evidence');
  const {initial,terminal,samples}=result;
  assert.ok(initial&&initial.tick===0&&initial.timeSeconds===0&&initial.status==='running','Must observe fresh match before first logic tick');
  assert.ok(terminal&&terminal.tick>0&&terminal.timeSeconds>0,'Match has no natural terminal');
  assert.equal(initial.contentVersion,11);assert.equal(terminal.contentVersion,11);
  const reasons={blueWin:['redBaseDestroyed','mutualBaseDestruction'],redWin:['blueBaseDestroyed'],timeout:['maxMatchSeconds']};
  assert.ok(reasons[terminal.status]?.includes(terminal.endReason),'Invalid natural end reason');
  assert.equal(terminal.winner,terminal.status==='blueWin'?0:terminal.status==='redWin'?1:null);
  assert.ok(Array.isArray(terminal.bases)&&terminal.bases.length===2,'Missing terminal bases');
  const blue=terminal.bases.find(b=>b.team===0),red=terminal.bases.find(b=>b.team===1);
  assert.ok(blue&&red,'Missing base teams');
  const down=b=>b.alive===false&&Number.isFinite(b.hp)&&b.hp<=0;
  const alive=b=>b.alive===true&&Number.isFinite(b.hp)&&b.hp>0;
  if(terminal.endReason==='blueBaseDestroyed')assert.ok(down(blue)&&alive(red),'Base state disagrees with outcome');
  if(terminal.endReason==='redBaseDestroyed')assert.ok(down(red)&&alive(blue),'Base state disagrees with outcome');
  if(terminal.endReason==='mutualBaseDestruction')assert.ok(down(red)&&down(blue),'Base state disagrees with outcome');
  if(terminal.status==='timeout')assert.ok(alive(red)&&alive(blue)&&terminal.timeSeconds>=1200,'Not the shipped natural rules timeout');

  assert.ok(Array.isArray(samples)&&samples.length>1,'Missing full-match frames');
  let tick=0,time=0,previousAt=null;
  // RAF timestamps identify rendering opportunities, not individual callbacks.
  // Preserve every raw callback and aggregate same-timestamp CPU without discarding work.
  const frames=[];
  for(const s of samples){
    assert.ok(Number.isFinite(s.atMs)&&s.atMs>=0,'Missing RAF timestamp');
    if(previousAt!==null)assert.ok(s.atMs>=previousAt&&Math.abs(s.atMs-previousAt-s.intervalMs)<.00001,'Non-contiguous frame timestamps');
    assert.ok(Number.isFinite(s.callbackMs)&&s.callbackMs>=0,'Invalid callback timing');
    if(previousAt!==null)assert.ok(Number.isFinite(s.intervalMs)&&s.intervalMs>=0,'Invalid callback interval');
    if(frames.at(-1)?.atMs===s.atMs){frames.at(-1).callbackMs+=s.callbackMs;frames.at(-1).callbacks++;}
    else frames.push({atMs:s.atMs,callbackMs:s.callbackMs,callbacks:1});
    previousAt=s.atMs;
    assert.ok(Number.isInteger(s.tick)&&s.tick>=tick&&Number.isFinite(s.timeSeconds)&&s.timeSeconds>=time,'Match restarted or invalid sample');
    tick=s.tick;time=s.timeSeconds;
  }
  assert.equal(tick,terminal.tick);assert.equal(time,terminal.timeSeconds);
  assert.equal(samples[0].intervalMs,null,'First interval must be unmeasured');
  assert.ok(frames.length>1,'Missing distinct full-match frames');
  const intervals=frames.slice(1).map((f,i)=>f.atMs-frames[i].atMs);
  const elapsedMs=intervals.reduce((a,b)=>a+b,0);
  assert.ok(elapsedMs>=terminal.timeSeconds*1000-1000,'Match timing does not cover real-time simulation');
  return {acceptanceReady:false,acceptanceLimit:'Functional observation only; comparative performance and blind quality review are not established.',scenario:'fresh idle player, normal opposing bot, no injected commands',initial,terminal,elapsedMs,firstFrameAtMs:samples[0].atMs,lastFrameAtMs:samples.at(-1).atMs,frames:frames.length,callbacks:samples.length,sameFrameExtraCallbacks:samples.length-frames.length,startedAt:result.startedAt,finishedAt:result.finishedAt,visibilityChanges:result.visibilityChanges,callbackCpu:distribution(samples.map(s=>s.callbackMs)),frameCallbackCpu:distribution(frames.map(f=>f.callbackMs)),frameIntervals:distribution(intervals),timingScope:'All observed requestAnimationFrame callbacks retained; per-callback CPU and summed callback CPU per shared RAF timestamp, intervals between distinct RAF timestamps; not GPU execution time or exclusively game CPU; observer overhead affects intervals'};
}
