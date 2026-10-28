import type {HeroSnapshot} from '../sim/types.js';
/** Actual rejected input feedback; aiming instructions remain until the next input. */
export function createCommandNotice(){
  let text='',reason:string|null=null,expiresAt=0;
  return {
    say(value:string){text=value;reason=null;},
    reject(value:string,time:number){reason=value;expiresAt=time+2;text=`Command rejected: ${value}`;},
    read(hero:HeroSnapshot,time:number){
      if(reason!==null&&(time>=expiresAt||(reason==='stunned'&&!hero.stunned)||(reason==='casting'&&hero.castSlot===null))){text='';reason=null;}
      return text;
    }
  };
}
