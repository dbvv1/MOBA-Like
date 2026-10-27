import {describe,it,expect} from 'vitest';
import {LocalMatch} from '../../src/save/match.js';
import {createSaveSlot,MATCH_SAVE_KEY,type SaveStorage} from '../../src/save/storage.js';
import {testNavigation} from '../helpers.js';
const ID='test-rules';
async function checkpoint(){return new LocalMatch({seed:1,contentVersion:10,heroIdsByTeam:[['veyra'],['veyra']],maxMatchSeconds:1200,botSeed:1002,botDifficulty:'normal'},await testNavigation(),ID).checkpoint();}
function storage(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};}
describe('single local checkpoint slot',()=>{
  it('writes and reads through a new owner, then clears a finished/replaced match',async()=>{
    const db=storage(),slot=createSaveSlot(()=>db,ID),save=await checkpoint();
    expect(slot.read()).toEqual({status:'empty'});expect(slot.write(save)).toEqual({status:'saved',tick:0});
    expect(createSaveSlot(()=>db,ID).read()).toEqual({status:'ready',save});
    expect(slot.clear()).toEqual({status:'cleared'});expect(slot.read()).toEqual({status:'empty'});
  });
  it('never repairs bad data on read, and only explicit replacement removes it',()=>{
    for(const raw of ['{','null','{"formatVersion":99}']){
      const db=storage();db.data.set(MATCH_SAVE_KEY,raw);const slot=createSaveSlot(()=>db,ID);
      expect(slot.read().status).not.toBe('ready');expect(db.data.get(MATCH_SAVE_KEY)).toBe(raw);
      expect(slot.clear().status).toBe('cleared');
    }
  });
  it('reports getter/read/write/delete failures and retains the last good save for retry',async()=>{
    const db=storage(),save=await checkpoint();let mode='ok';
    const provider=():SaveStorage=>{if(mode==='getter')throw Error();return {
      getItem:key=>{if(mode==='read')throw Error();return db.getItem(key);},
      setItem:(key,value)=>{if(mode==='write')throw Error();db.setItem(key,value);},
      removeItem:key=>{if(mode==='delete')throw Error();db.removeItem(key);},
    };};
    const slot=createSaveSlot(provider,ID);slot.read();expect(slot.write(save).status).toBe('saved');
    const original=db.getItem(MATCH_SAVE_KEY);
    for(const failure of ['getter','read','write']){mode=failure;expect(slot.write(save).status).toBe('unavailable');expect(db.getItem(MATCH_SAVE_KEY)).toBe(original);}
    mode='delete';expect(slot.clear().status).toBe('unavailable');expect(db.getItem(MATCH_SAVE_KEY)).toBe(original);
    mode='ok';expect(slot.write(save).status).toBe('saved');
  });
  it('refuses stale owners instead of overwriting another tab or an external edit',async()=>{
    const db=storage(),slot=createSaveSlot(()=>db,ID),save=await checkpoint();slot.read();db.setItem(MATCH_SAVE_KEY,'other');
    expect(slot.write(save).status).toBe('conflict');expect(slot.clear().status).toBe('conflict');expect(db.getItem(MATCH_SAVE_KEY)).toBe('other');
  });
});
