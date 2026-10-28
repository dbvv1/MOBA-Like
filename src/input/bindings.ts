import type {AbilitySlot} from '../content/types.js';

export type BindingAction = AbilitySlot|'attackMove'|'stop'|'focusCamera';
export type BindingMap = Record<BindingAction,string>;
export const DEFAULT_BINDINGS: Readonly<BindingMap> = Object.freeze({Q:'Q',W:'W',E:'E',R:'R',attackMove:'A',stop:'S',focusCamera:'Space'});
export const BINDING_ACTIONS = Object.freeze(Object.keys(DEFAULT_BINDINGS) as BindingAction[]);
export const BINDINGS_STORAGE_KEY = 'moba-like.keyboard.v1';
type StoragePort = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type KeyInput = Pick<KeyboardEvent,'key'|'repeat'|'altKey'|'ctrlKey'|'metaKey'|'isComposing'>;
export type EditResult = {ok:true}|{ok:false;reason:'unsupported-key'}|{ok:false;reason:'conflict';action:BindingAction};
export type CaptureResult = EditResult|{ok:false;reason:'inactive'|'ignored'|'cancelled'};

// Keep the original logical-key contract: Q means the key producing Q, not KeyQ's physical location.
// Escape/Tab/Enter stay available to navigation. No chords, dead keys or IME composition in this first version.
function canonicalKey(key:string):string|null {
  if(key===' '||key==='Space')return 'Space';
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key))return key;
  return /^[a-z0-9]$/i.test(key)?key.toUpperCase():null;
}
function ignored(event:KeyInput){return event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.isComposing;}
export function actionForKey(bindings:Readonly<BindingMap>,event:KeyInput):BindingAction|null {
  if(ignored(event))return null;
  const key=canonicalKey(event.key);
  return key===null?null:BINDING_ACTIONS.find(action=>bindings[action]===key)??null;
}
export function bindingLabel(key:string):string {
  return ({ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'} as Record<string,string>)[key]??key;
}
function validMap(value:unknown):value is BindingMap {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const map=value as Record<string,unknown>;
  return Object.keys(map).length===BINDING_ACTIONS.length
    &&BINDING_ACTIONS.every(action=>typeof map[action]==='string'&&canonicalKey(map[action])===map[action])
    &&new Set(Object.values(map)).size===BINDING_ACTIONS.length;
}

/** One local keyboard preference. The original command/simulation remains the action owner. */
export class KeyboardBindings {
  private effective:BindingMap={...DEFAULT_BINDINGS};
  private pending:BindingMap={...DEFAULT_BINDINGS};
  private capturing:BindingAction|null=null;
  notice='';
  constructor(private storage:()=>StoragePort){
    try{
      const raw=storage().getItem(BINDINGS_STORAGE_KEY);
      if(raw!==null){
        const saved:unknown=JSON.parse(raw);
        if(saved&&typeof saved==='object'&&'version' in saved&&saved.version===1&&'bindings' in saved&&validMap(saved.bindings))this.effective={...saved.bindings};
        else this.notice='Saved keyboard settings are incompatible; using defaults until you apply or reset.';
      }
    }catch{this.notice='Keyboard settings could not be read; using defaults until you apply or reset.';}
    this.pending={...this.effective};
  }
  get value():Readonly<BindingMap>{return {...this.effective};}
  get draft():Readonly<BindingMap>{return {...this.pending};}
  get captureAction(){return this.capturing;}
  get dirty(){return BINDING_ACTIONS.some(action=>this.pending[action]!==this.effective[action]);}
  resolve(event:KeyInput){return actionForKey(this.effective,event);}
  label(action:BindingAction){return bindingLabel(this.effective[action]);}
  edit(action:BindingAction,key:string,conflict:'reject'|'swap'='reject'):EditResult {
    const canonical=canonicalKey(key);
    if(canonical===null)return {ok:false,reason:'unsupported-key'};
    const other=BINDING_ACTIONS.find(candidate=>candidate!==action&&this.pending[candidate]===canonical);
    if(other&&conflict==='reject')return {ok:false,reason:'conflict',action:other};
    if(other)this.pending[other]=this.pending[action];
    this.pending[action]=canonical;this.notice='Changes are not applied yet.';return {ok:true};
  }
  beginCapture(action:BindingAction){this.capturing=action;}
  cancelCapture(){this.capturing=null;}
  capture(event:KeyInput):CaptureResult {
    if(this.capturing===null)return {ok:false,reason:'inactive'};
    if(ignored(event))return {ok:false,reason:'ignored'};
    if(event.key==='Escape'){this.cancelCapture();return {ok:false,reason:'cancelled'};}
    const result=this.edit(this.capturing,event.key);
    if(result.ok)this.cancelCapture();
    return result;
  }
  cancel(){this.cancelCapture();this.pending={...this.effective};this.notice='Changes cancelled.';}
  defaults(){this.cancelCapture();this.pending={...DEFAULT_BINDINGS};this.notice='Defaults selected; apply to save and use them.';}
  apply(){
    if(this.capturing!==null){this.notice='Finish or cancel key capture before applying.';return false;}
    try{
      const store=this.storage();
      if(BINDING_ACTIONS.every(action=>this.pending[action]===DEFAULT_BINDINGS[action]))store.removeItem(BINDINGS_STORAGE_KEY);
      else store.setItem(BINDINGS_STORAGE_KEY,JSON.stringify({version:1,bindings:this.pending}));
    }catch{this.notice='Could not save keyboard settings. Existing controls are unchanged; retry or cancel.';return false;}
    this.effective={...this.pending};this.notice='Keyboard settings saved and applied in this browser.';return true;
  }
}
