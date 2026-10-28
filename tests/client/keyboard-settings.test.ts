// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {BINDINGS_STORAGE_KEY,DEFAULT_BINDINGS,KeyboardBindings} from '../../src/input/bindings.js';
import {controlsHelp,createKeyboardSettings} from '../../src/ui/keyboard-settings.js';
import {createHud} from '../../src/ui/hud.js';
import {createHeroSelection} from '../../src/ui/hero-selection.js';
import {Simulation} from '../../src/sim/simulation.js';

// CPU DOM integration, not browser/render/focus-inertness certification.
const names={Q:'Skill 1',W:'Skill 2',E:'Skill 3',R:'Ultimate',attackMove:'Attack-move',stop:'Stop',focusCamera:'Lock camera'};
const navigation={closestPoint:(p:{x:number;z:number})=>({...p}),findPath:(a:{x:number;z:number},b:{x:number;z:number})=>({success:true,points:[a,b],reason:null})};
let dispose=()=>{};
beforeEach(()=>{
  document.body.innerHTML='<button id="trigger">Keyboard settings</button><dialog></dialog><section id="hud"></section><select></select><p id="hero-details"></p>';
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;this.dispatchEvent(new Event('close'));}});
});
afterEach(()=>{dispose();vi.restoreAllMocks();document.body.replaceChildren();});
function fixture(initial?:string){
  const values=new Map<string,string>();if(initial!==undefined)values.set(BINDINGS_STORAGE_KEY,initial);
  const store={getItem:vi.fn((key:string)=>values.get(key)??null),setItem:vi.fn((key:string,value:string)=>{values.set(key,value);}),removeItem:vi.fn((key:string)=>{values.delete(key);})};
  const bindings=new KeyboardBindings(()=>store),trigger=document.querySelector<HTMLButtonElement>('#trigger')!,dialog=document.querySelector('dialog')!,change=vi.fn(),applied=vi.fn();
  const editor=createKeyboardSettings(dialog,trigger,bindings,names,change,applied);dispose=()=>editor.dispose();
  const button=(selector:string)=>dialog.querySelector<HTMLButtonElement>(selector)!;
  const action=(name:string)=>button(`[data-binding-action="${name}"]`);
  const key=(key:string,extra:KeyboardEventInit={})=>{const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});document.activeElement!.dispatchEvent(event);return event;};
  const click=(selector:string)=>{const target=button(selector);target.focus();target.click();};
  const open=()=>{trigger.focus();trigger.click();};
  const capture=(name:string,value:string)=>{const target=action(name);target.focus();target.click();key(value);};
  return {bindings,trigger,dialog,change,applied,editor,store,values,button,action,key,click,open,capture,status:()=>button('[data-binding-status]').textContent};
}

describe('keyboard settings editor uses one draft/effective binding owner',()=>{
  it('opens through the existing menu button, captures without applying and cancels back to the opener',()=>{
    const f=fixture();f.open();expect(f.dialog.open).toBe(true);expect(f.change).toHaveBeenLastCalledWith(true);expect(document.activeElement).toBe(f.action('Q'));
    f.capture('Q','f');expect(f.action('Q').textContent).toBe('F');expect(f.bindings.value.Q).toBe('Q');expect(f.store.setItem).not.toHaveBeenCalled();
    f.click('[data-binding-cancel]');expect(f.dialog.open).toBe(false);expect(f.bindings.draft.Q).toBe('Q');expect(f.change).toHaveBeenLastCalledWith(false);expect(document.activeElement).toBe(f.trigger);
    f.open();expect(f.action('Q').textContent).toBe('Q');
  });
  it('names conflicts and exchanges both keys only after the explicit swap choice',()=>{
    const f=fixture();f.open();f.capture('Q','w');
    expect(f.status()).toContain('already used by Skill 2');expect(f.bindings.draft).toEqual(DEFAULT_BINDINGS);expect(f.button('[data-binding-swap]').hidden).toBe(false);
    f.click('[data-binding-swap]');expect(f.bindings.draft).toMatchObject({Q:'W',W:'Q'});expect(f.bindings.value).toEqual(DEFAULT_BINDINGS);expect(f.bindings.captureAction).toBeNull();
    f.click('[data-binding-save]');expect(f.bindings.value).toMatchObject({Q:'W',W:'Q'});expect(f.applied).toHaveBeenCalledTimes(1);expect(f.dialog.open).toBe(false);
    expect(new KeyboardBindings(()=>f.store).value).toEqual(f.bindings.value);
  });
  it('does not report a save while a rejected conflicting key still awaits an explicit decision',()=>{
    const f=fixture();f.open();f.capture('Q','w');f.click('[data-binding-save]');
    expect(f.dialog.open).toBe(true);expect(f.status()).toContain('Resolve the key conflict');expect(f.store.setItem).not.toHaveBeenCalled();expect(f.applied).not.toHaveBeenCalled();
    f.capture('Q','f');f.click('[data-binding-save]');expect(f.bindings.value.Q).toBe('F');
  });
  it('requires a fresh Escape press after cancelling capture instead of dropping drafts on held-key repeat',()=>{
    const f=fixture();f.open();f.capture('W','f');f.action('Q').focus();f.action('Q').click();f.key('Escape');
    expect(f.bindings.captureAction).toBeNull();expect(f.key('Escape',{repeat:true}).defaultPrevented).toBe(true);expect(f.dialog.open).toBe(true);expect(f.bindings.draft.W).toBe('F');
    f.key('Escape');expect(f.dialog.open).toBe(false);expect(f.bindings.draft.W).toBe('W');
  });
  it('supports replacement instead of swapping and keeps Escape capture cancellation distinct from menu cancellation',()=>{
    const f=fixture();f.open();f.capture('Q','w');f.key('f');expect(f.bindings.draft.Q).toBe('F');expect(f.button('[data-binding-swap]').hidden).toBe(true);
    f.action('E').focus();f.action('E').click();f.key('Escape');expect(f.dialog.open).toBe(true);expect(f.bindings.captureAction).toBeNull();expect(f.bindings.draft.Q).toBe('F');
    f.key('Escape');expect(f.dialog.open).toBe(false);expect(f.bindings.draft.Q).toBe('Q');
  });
  it('keeps effective keys and the editable draft on failed save; retry commits once',()=>{
    const f=fixture();f.open();f.capture('attackMove','d');f.store.setItem.mockImplementationOnce(()=>{throw new Error('quota');});
    f.click('[data-binding-save]');expect(f.dialog.open).toBe(true);expect(f.status()).toContain('Existing controls are unchanged');expect(f.bindings.value.attackMove).toBe('A');expect(f.bindings.draft.attackMove).toBe('D');expect(f.applied).not.toHaveBeenCalled();
    f.click('[data-binding-save]');expect(f.dialog.open).toBe(false);expect(f.bindings.value.attackMove).toBe('D');expect(f.applied).toHaveBeenCalledTimes(1);
  });
  it('restores defaults only on apply, removes saved overrides, and retains old keys when removal fails',()=>{
    const f=fixture();f.open();f.capture('stop','x');f.click('[data-binding-save]');
    f.open();f.click('[data-binding-defaults]');expect(f.bindings.draft).toEqual(DEFAULT_BINDINGS);expect(f.bindings.value.stop).toBe('X');
    f.click('[data-binding-cancel]');expect(new KeyboardBindings(()=>f.store).value.stop).toBe('X');
    f.open();f.click('[data-binding-defaults]');f.store.removeItem.mockImplementationOnce(()=>{throw new Error('denied');});f.click('[data-binding-save]');
    expect(f.dialog.open).toBe(true);expect(f.bindings.value.stop).toBe('X');f.click('[data-binding-save]');
    expect(f.values.has(BINDINGS_STORAGE_KEY)).toBe(false);expect(new KeyboardBindings(()=>f.store).value).toEqual(DEFAULT_BINDINGS);
  });
  it('does not overwrite corrupt storage until the player explicitly saves defaults even when not dirty',()=>{
    const f=fixture('{broken');f.open();expect(f.status()).toContain('could not be read');expect(f.values.get(BINDINGS_STORAGE_KEY)).toBe('{broken');
    f.click('[data-binding-defaults]');expect(f.bindings.dirty).toBe(false);expect(f.button('[data-binding-save]').disabled).toBe(false);f.click('[data-binding-save]');expect(f.values.has(BINDINGS_STORAGE_KEY)).toBe(false);
  });
  it('cancels capture on Tab, row focus loss and window blur without discarding edited drafts',()=>{
    const f=fixture();f.open();f.capture('W','g');f.action('Q').focus();f.action('Q').click();const tab=f.key('Tab');expect(tab.defaultPrevented).toBe(false);expect(f.bindings.captureAction).toBeNull();
    f.action('Q').click();f.action('E').focus();expect(f.bindings.captureAction).toBeNull();
    f.action('E').click();window.dispatchEvent(new Event('blur'));expect(f.bindings.captureAction).toBeNull();expect(f.bindings.draft.W).toBe('G');expect(f.dialog.open).toBe(true);
  });
  it('reserves navigation, consumes Space during capture and ignores held/chord/IME input',()=>{
    const f=fixture();f.open();f.action('Q').click();
    for(const extra of [{repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true},{isComposing:true}])f.key('f',extra);
    expect(f.bindings.draft.Q).toBe('Q');f.key('Enter');expect(f.status()).toContain('reserved');expect(f.bindings.captureAction).toBe('Q');
    f.key('ArrowUp');expect(f.action('Q').textContent).toBe('↑');expect(f.bindings.captureAction).toBeNull();
    f.action('focusCamera').focus();f.action('focusCamera').click();expect(f.key(' ').defaultPrevented).toBe(true);expect(f.bindings.captureAction).toBeNull();
    f.button('[data-binding-save]').focus();expect(f.key('Tab').defaultPrevented).toBe(true);expect(document.activeElement).toBe(f.action('Q'));
    f.key('Tab',{shiftKey:true});expect(document.activeElement).toBe(f.button('[data-binding-save]'));
  });
  it('native dismissal cancels drafts; disposed editors never reactivate or re-enable the old owner',()=>{
    const f=fixture();f.open();f.capture('Q','f');f.dialog.close();expect(f.editor.isOpen).toBe(false);expect(f.bindings.draft.Q).toBe('Q');
    f.open();f.capture('Q','f');f.editor.dispose();expect(f.dialog.open).toBe(false);expect(f.bindings.draft.Q).toBe('Q');expect(f.trigger.disabled).toBe(true);
    const changes=f.change.mock.calls.length;f.trigger.disabled=false;f.trigger.click();window.dispatchEvent(new Event('blur'));expect(f.change).toHaveBeenCalledTimes(changes);
  });
  it('does not let a delayed close event from a prior visit dismiss a freshly reopened editor',()=>{
    const f=fixture();f.open();f.click('[data-binding-cancel]');f.open();f.dialog.dispatchEvent(new Event('close'));
    expect(f.editor.isOpen).toBe(true);expect(f.dialog.open).toBe(true);expect(f.change).toHaveBeenLastCalledWith(true);
  });
  it('HUD, hero hints and help read actual keys while button actions keep stable skill slots',()=>{
    const f=fixture(),sim=new Simulation({seed:1,contentVersion:10,navigation,heroesPerTeam:1}),snapshot=sim.snapshot(),onSkill=vi.fn();
    const hud=createHud(document.querySelector('#hud')!,sim.catalog,onSkill,()=>{},()=>{},f.bindings);
    const selection=createHeroSelection(document.querySelector('select')!,document.querySelector('#hero-details')!,sim.catalog,slot=>f.bindings.label(slot));
    try{
      f.bindings.edit('Q','F');hud.update(snapshot,snapshot.heroes[0]!.id);expect(document.querySelector('[data-skills] button span')!.textContent).toMatch(/^Q /);
      f.bindings.apply();hud.update(snapshot,snapshot.heroes[0]!.id);selection.refresh();
      const skill=document.querySelector<HTMLButtonElement>('[data-skills] button')!;expect(skill.textContent).toMatch(/^F /);expect(skill.title).toMatch(/^F:/);skill.click();expect(onSkill).toHaveBeenLastCalledWith('Q');
      expect(document.querySelector('select')!.title).toContain('F:');expect(controlsHelp(f.bindings)).toContain('F/W/E/R');
    }finally{hud.dispose();}
  });
});
