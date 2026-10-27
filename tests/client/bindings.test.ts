import {describe,it,expect} from 'vitest';
import {KeyboardBindings,DEFAULT_BINDINGS,BINDINGS_STORAGE_KEY,actionForKey,bindingLabel} from '../../src/input/bindings.js';

function storage(initial:string|null=null){
  const values=new Map<string,string>();if(initial!==null)values.set(BINDINGS_STORAGE_KEY,initial);
  values.set('unrelated-setting','keep');let fail=false;
  return {values,fail(value:boolean){fail=value;},getItem:(key:string)=>values.get(key)??null,
    setItem(key:string,value:string){if(fail)throw Error('quota');values.set(key,value);},
    removeItem(key:string){if(fail)throw Error('quota');values.delete(key);}};
}
const key=(value:string,extra:Partial<KeyboardEvent>={})=>({key:value,repeat:false,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,...extra});

describe('keyboard preference edits use the existing apply/cancel setting contract',()=>{
  it('keeps original logical QWER/A/S/Space defaults and separate action identities',()=>{
    const settings=new KeyboardBindings(()=>storage());expect(settings.value).toEqual(DEFAULT_BINDINGS);
    for(const [action,value] of Object.entries(DEFAULT_BINDINGS))expect(settings.resolve(key(value==='Space'?' ':value.toLowerCase()))).toBe(action);
    expect(actionForKey(DEFAULT_BINDINGS,key('q',{code:'KeyA'}))).toBe('Q');
    expect(actionForKey(DEFAULT_BINDINGS,key('a',{code:'KeyQ'}))).toBe('attackMove');
    expect(bindingLabel('ArrowLeft')).toBe('←');expect(bindingLabel('F')).toBe('F');
  });
  it('drafts do not change controls; apply is persisted and re-read by a new owner',()=>{
    const store=storage(),settings=new KeyboardBindings(()=>store);
    expect(settings.edit('Q','f')).toEqual({ok:true});expect(settings.dirty).toBe(true);
    expect(settings.resolve(key('q'))).toBe('Q');expect(settings.resolve(key('f'))).toBeNull();
    expect(settings.apply()).toBe(true);expect(settings.resolve(key('f'))).toBe('Q');expect(settings.resolve(key('q'))).toBeNull();
    const next=new KeyboardBindings(()=>store);expect(next.label('Q')).toBe('F');expect(next.dirty).toBe(false);
    expect(store.values.get('unrelated-setting')).toBe('keep');
  });
  it('cancel discards edits and snapshots cannot mutate current or pending bindings',()=>{
    const settings=new KeyboardBindings(()=>storage());settings.edit('Q','F');
    (settings.value as Record<string,string>).Q='X';(settings.draft as Record<string,string>).Q='Y';
    expect(settings.draft.Q).toBe('F');expect(settings.value.Q).toBe('Q');settings.cancel();
    expect(settings.draft).toEqual(DEFAULT_BINDINGS);expect(settings.dirty).toBe(false);
  });
  it('conflicts preserve both actions unless the caller explicitly requests a swap',()=>{
    const settings=new KeyboardBindings(()=>storage());
    expect(settings.edit('Q','w')).toEqual({ok:false,reason:'conflict',action:'W'});expect(settings.draft).toEqual(DEFAULT_BINDINGS);
    expect(settings.edit('Q','w','swap')).toEqual({ok:true});expect(settings.draft.Q).toBe('W');expect(settings.draft.W).toBe('Q');
    expect(settings.apply()).toBe(true);expect(settings.resolve(key('w'))).toBe('Q');expect(settings.resolve(key('q'))).toBe('W');
  });
  it('capturing is explicit, ignores repeats/chords/composition, and Esc only cancels capture',()=>{
    const settings=new KeyboardBindings(()=>storage());expect(settings.capture(key('f'))).toEqual({ok:false,reason:'inactive'});
    settings.edit('W','G');settings.beginCapture('Q');
    for(const extra of [{repeat:true},{altKey:true},{ctrlKey:true},{metaKey:true},{isComposing:true}])expect(settings.capture(key('f',extra))).toEqual({ok:false,reason:'ignored'});
    expect(settings.capture(key('g'))).toEqual({ok:false,reason:'conflict',action:'W'});expect(settings.captureAction).toBe('Q');
    expect(settings.capture(key('Escape'))).toEqual({ok:false,reason:'cancelled'});expect(settings.draft.W).toBe('G');
    settings.beginCapture('Q');expect(settings.capture(key('f'))).toEqual({ok:true});expect(settings.captureAction).toBeNull();
    expect(settings.draft.Q).toBe('F');expect(settings.value.Q).toBe('Q');
  });
  it('reserved navigation keys and unidentified/dead keys cannot become gameplay bindings',()=>{
    const settings=new KeyboardBindings(()=>storage());settings.beginCapture('Q');
    for(const value of ['Tab','Enter','Escape','Dead','Process','Unidentified','F5','Control'])expect(settings.edit('Q',value)).toEqual({ok:false,reason:'unsupported-key'});
    expect(settings.apply()).toBe(false);expect(settings.capture(key('Escape'))).toEqual({ok:false,reason:'cancelled'});expect(settings.captureAction).toBeNull();
    settings.beginCapture('Q');expect(settings.capture(key('ArrowUp'))).toEqual({ok:true});expect(settings.captureAction).toBeNull();expect(settings.draft.Q).toBe('ArrowUp');
  });
  it('write and reset failures leave effective controls and old stored bytes intact',()=>{
    const store=storage(),settings=new KeyboardBindings(()=>store);settings.edit('Q','F');expect(settings.apply()).toBe(true);
    const old=store.values.get(BINDINGS_STORAGE_KEY);settings.edit('Q','G');store.fail(true);
    expect(settings.apply()).toBe(false);expect(settings.value.Q).toBe('F');expect(settings.draft.Q).toBe('G');expect(store.values.get(BINDINGS_STORAGE_KEY)).toBe(old);
    settings.defaults();expect(settings.apply()).toBe(false);expect(settings.value.Q).toBe('F');
    store.fail(false);expect(settings.apply()).toBe(true);expect(store.values.has(BINDINGS_STORAGE_KEY)).toBe(false);
    expect(new KeyboardBindings(()=>store).value).toEqual(DEFAULT_BINDINGS);expect(store.values.get('unrelated-setting')).toBe('keep');
  });
  it('missing, malformed, incomplete, conflicting and old-version storage fall back without rewriting it',()=>{
    const invalid=['{',JSON.stringify({version:0,bindings:DEFAULT_BINDINGS}),JSON.stringify({version:1,bindings:{Q:'F'}}),
      JSON.stringify({version:1,bindings:{...DEFAULT_BINDINGS,Q:'W'}}),JSON.stringify({version:1,bindings:{...DEFAULT_BINDINGS,Q:'Escape'}})];
    for(const raw of invalid){const store=storage(raw),settings=new KeyboardBindings(()=>store);expect(settings.value).toEqual(DEFAULT_BINDINGS);expect(settings.notice).not.toBe('');expect(store.values.get(BINDINGS_STORAGE_KEY)).toBe(raw);}
    const denied=new KeyboardBindings(()=>{throw Error('unavailable');});expect(denied.value).toEqual(DEFAULT_BINDINGS);expect(denied.notice).toContain('could not be read');
    expect(new KeyboardBindings(()=>storage()).notice).toBe('');
  });
});
