import {decodeMatchSave,MAX_SAVE_CHARS,SaveError,type MatchSave} from './match.js';

export const MATCH_SAVE_KEY='ashen-furrow-local-match-v1';
export interface SaveStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export type ReadSave={status:'ready';save:MatchSave}|{status:'empty'|'unavailable'|'invalid'|'incompatible'|'limit'};
export type WriteSave={status:'saved';tick:number}|{status:'cleared'|'unavailable'|'conflict'|'invalid'|'incompatible'|'limit'};

/** Caller holds the browser Web Lock throughout this owner's lifetime. */
export function createSaveSlot(storage:()=>SaveStorage,compatibilityId:string){
  let expected:string|null=null,observed=false;
  return {
    read():ReadSave {
      let raw:string|null;
      try{raw=storage().getItem(MATCH_SAVE_KEY);}catch{return {status:'unavailable'};}
      expected=raw;observed=true;
      if(raw===null)return {status:'empty'};
      try{return {status:'ready',save:decodeMatchSave(raw,compatibilityId)};}
      catch(error){return {status:error instanceof SaveError&&error.code!=='mismatch'?error.code:'invalid'};}
    },
    write(save:MatchSave):WriteSave {
      let raw:string;
      try{raw=JSON.stringify(save);if(raw.length>MAX_SAVE_CHARS)return {status:'limit'};decodeMatchSave(raw,compatibilityId);}
      catch(error){return {status:error instanceof SaveError&&error.code!=='mismatch'?error.code:'invalid'};}
      try{
        const target=storage();
        if(!observed||target.getItem(MATCH_SAVE_KEY)!==expected)return {status:'conflict'};
        target.setItem(MATCH_SAVE_KEY,raw);expected=raw;
        return {status:'saved',tick:save.tick};
      }catch{return {status:'unavailable'};}
    },
    clear():WriteSave {
      try{
        const target=storage();
        if(!observed||target.getItem(MATCH_SAVE_KEY)!==expected)return {status:'conflict'};
        target.removeItem(MATCH_SAVE_KEY);expected=null;return {status:'cleared'};
      }catch{return {status:'unavailable'};}
    },
  };
}
