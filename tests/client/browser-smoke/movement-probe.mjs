import assert from 'node:assert/strict';

// Serialized into the page by Playwright. Observation only: no command, clock or input mutation.
export function installMovementProbe(heroId) {
  const sample=()=>{
    const snapshot=window.mobaClient.snapshot();
    return structuredClone({tick:snapshot.tick,status:snapshot.status,hero:snapshot.heroes.find(h=>h.id===heroId),pointer:window.mobaClient.state().pointer});
  };
  const probe={beforeMove:sample(),click:null,beforeStop:null};
  const pointer=event=>{
    if(event.button!==2||event.target!==document.querySelector('#stage canvas'))return;
    window.removeEventListener('pointerdown',pointer,false);
    const input={x:event.clientX,y:event.clientY,trusted:event.isTrusted,timeStamp:event.timeStamp};
    // Window bubble runs after the existing canvas controls handler. No microtask-order assumption.
    probe.click={input,...sample()};
  };
  const stop=event=>{
    if(event.key.toLowerCase()!=='s')return;
    probe.beforeStop={input:{key:event.key,trusted:event.isTrusted,timeStamp:event.timeStamp},...sample()};
    window.removeEventListener('keydown',stop,true);
  };
  window.addEventListener('pointerdown',pointer,false);
  window.addEventListener('keydown',stop,true);
  window.__mobaMovementProbe=probe;
  window.__mobaMovementProbeCleanup=()=>{window.removeEventListener('pointerdown',pointer,false);window.removeEventListener('keydown',stop,true);};
}

export function assertActiveMoveAtStop(probe) {
  assert.equal(probe.click?.input.trusted,true,'Move must come from real page input');
  assert.equal(probe.click?.pointer?.command?.type,'move','Right click must issue movement, not attack or no-op');
  const before=probe.beforeMove.hero,stop=probe.beforeStop;
  assert.equal(stop?.input.trusted,true,'Stop must come from real page keyboard input');
  assert.equal(stop?.status,'running');assert.equal(stop?.hero?.alive,true);
  assert.ok(stop.hero.moveGoal,'Move must still be active before stop');
  assert.ok(Math.hypot(stop.hero.position.x-before.position.x,stop.hero.position.z-before.position.z)>.1,'Movement must occur before the real stop key');
}

export function assertStoppedAtKeyPosition(probe,stopped,later) {
  const atKey=probe.beforeStop.hero;
  assert.equal(stopped.alive,true);assert.equal(later.alive,true);
  assert.equal(stopped.moveGoal,null);assert.equal(later.moveGoal,null);
  for(const hero of [stopped,later])assert.ok(Math.hypot(hero.position.x-atKey.position.x,hero.position.z-atKey.position.z)<1e-8,'S must stop at its actual keydown position, not pass by natural arrival');
}
