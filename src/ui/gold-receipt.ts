import type {PresentationEvent} from '../sim/types.js';

type GoldAward = Extract<PresentationEvent,{type:'goldAwarded'}>;

/** How long a received award stays readable, in simulation time only. */
export const GOLD_RECEIPT_LIFETIME_SECONDS=2;

const REASON_LABELS:Readonly<Record<GoldAward['reason'],string>>={
  heroKill:'击杀',
  heroTeamReward:'团队击杀',
  minionLastHit:'补刀',
  structureLastHit:'摧毁',
  structureTeamReward:'团队目标',
};

export interface GoldReceipt {
  /** Take one real step's event batch. Duplicate batches and repeated reads change nothing. */
  consume(events:readonly PresentationEvent[],timeSeconds:number):void;
  /** Latest award, or an empty string once its simulation-time lifetime has passed. */
  read(timeSeconds:number):string;
  reset():void;
}

/**
 * Player-only receipt for the authoritative gold spikes in presentation events.
 * Amount and reason come from the event; balances and passive income are never inferred.
 */
export function createGoldReceipt(playerId:number):GoldReceipt{
  let lastTick=-1,lastOrdinal=-1;
  let shownTick=-1,amount=0;
  let reasons=new Set<GoldAward['reason']>();
  let text='',expiresAt=0;
  return {
    consume(events,timeSeconds){
      let latestTick=-1;
      const latest:GoldAward[]=[];
      for(const event of events){
        if(event.type!=='goldAwarded')continue;
        // The batch contract is per-tick and monotonic; this cursor also drops a replayed batch.
        if(event.tick<lastTick||(event.tick===lastTick&&event.ordinal<=lastOrdinal))continue;
        lastTick=event.tick;lastOrdinal=event.ordinal;
        if(event.recipientId!==playerId||event.amount<=0)continue;
        if(event.tick>latestTick){latestTick=event.tick;latest.length=0;latest.push(event);}
        else if(event.tick===latestTick)latest.push(event);
      }
      if(latest.length===0)return;
      if(latestTick!==shownTick){shownTick=latestTick;amount=0;reasons=new Set();}
      for(const award of latest){amount+=award.amount;reasons.add(award.reason);}
      const label=reasons.size===1?REASON_LABELS[[...reasons][0]!]:'多项奖励';
      text=`+${amount} gold · ${label}`;
      expiresAt=timeSeconds+GOLD_RECEIPT_LIFETIME_SECONDS;
    },
    read(timeSeconds){
      return text!==''&&timeSeconds<expiresAt?text:'';
    },
    reset(){
      lastTick=-1;lastOrdinal=-1;shownTick=-1;amount=0;reasons=new Set();text='';expiresAt=0;
    },
  };
}
