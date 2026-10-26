// Consume the authoritative current-step batch, never infer hits from HP or cooldowns.
export function createMotionState(heroId, catalog) {
  let attack=null,hurtAt=null,lastTick=-1,lastOrdinal=-1;
  return {
    reset(){attack=null;hurtAt=null;lastTick=-1;lastOrdinal=-1;},
    consume(events,time,alive){
      for(const event of events){
        if(event.tick<lastTick||(event.tick===lastTick&&event.ordinal<=lastOrdinal))continue;
        lastTick=event.tick;lastOrdinal=event.ordinal;
        if(!alive)continue;
        if(event.type==='castStarted'&&event.heroId===heroId){
          const ability=catalog.abilities[event.abilityId];
          if(ability)attack={castId:event.castId,startedAt:time,windup:ability.castTime,resolvedAt:null,cancelledAt:null};
        }else if(event.type==='castResolved'&&event.heroId===heroId){
          if(attack?.castId===event.castId)attack.resolvedAt=time;
        }else if(event.type==='castCancelled'&&event.heroId===heroId){
          if(attack?.castId===event.castId)attack.cancelledAt=time;
        }else if(event.type==='basicAttack'&&event.sourceId===heroId){
          // This event is the actual committed swing, not a pre-attack windup or hit.
          attack={castId:null,startedAt:time,windup:0,resolvedAt:time,cancelledAt:null};
        }else if(event.type==='heroDamaged'&&event.targetId===heroId&&event.hpDamage>0)hurtAt=time;
      }
      if(!alive){attack=null;hurtAt=null;}
    },
    finish(time){if(attack&&attack.resolvedAt===null&&attack.cancelledAt===null&&attack.visualStopAt===undefined)attack.visualStopAt=time;},
    inspect(){return {attack:attack?{...attack}:null,hurtAt};}
  };
}

// Source frame14 starts the strike; an authoritative resolve releases it.
// The source's later contact pose is visual only: it never emits gameplay damage.
export function attackSample(time,attack,{strike=5/30,recovery=17/30,fade=.06}={}){
  if(!attack)return {weight:0,time:0};
  if(![strike,recovery,fade].every(v=>Number.isFinite(v)&&v>0))throw new Error('Invalid attack visual timing');
  const sourceWindup=13/30,sourceStrike=5/30,sourceRecovery=17/30;
  const stopAt=attack.cancelledAt??attack.visualStopAt??null;
  const at=stopAt===null?time:Math.min(time,stopAt);
  let sourceTime=0,weight=Math.min(1,Math.max(0,(at-attack.startedAt)/fade));
  if(attack.resolvedAt===null||at<attack.resolvedAt){
    sourceTime=sourceWindup*Math.min(1,Math.max(0,(at-attack.startedAt)/Math.max(attack.windup,1e-9)));
  }else{
    const elapsed=Math.max(0,at-attack.resolvedAt);
    sourceTime=elapsed<strike?sourceWindup+sourceStrike*elapsed/strike:sourceWindup+sourceStrike+sourceRecovery*Math.min(1,(elapsed-strike)/recovery);
    weight*=Math.min(1,Math.max(0,(strike+recovery-elapsed)/fade));
  }
  if(stopAt!==null)weight*=Math.min(1,Math.max(0,1-(time-stopAt)/fade));
  return {weight,time:sourceTime};
}
