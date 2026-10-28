import {BINDING_ACTIONS,bindingLabel,type BindingAction,type KeyboardBindings} from '../input/bindings.js';

export type BindingNames=Readonly<Record<BindingAction,string>>;
export function controlsHelp(bindings:Pick<KeyboardBindings,'label'>){
  return `Right-click enemy: chase/attack · Right-click ground: move · ${(['Q','W','E','R'] as const).map(slot=>bindings.label(slot)).join('/')} then left-click: aim/cast · ${bindings.label('attackMove')} then left-click: attack-move · ${bindings.label('stop')}: stop · Esc: cancel aim · ${bindings.label('focusCamera')}: lock camera. Unlock camera to scroll at edges. Choose your next-match hero above, then Restart to begin a fresh match.`;
}

/** One modal editor for the existing binding owner. Native dialog owns background inertness. */
export function createKeyboardSettings(dialog:HTMLDialogElement,trigger:HTMLButtonElement,bindings:KeyboardBindings,names:BindingNames,onOpenChange:(open:boolean)=>void,onApplied:()=>void){
  dialog.innerHTML='<h2 id="keyboard-title">Keyboard settings</h2><p id="keyboard-instructions">Select a key, then press A–Z, 0–9, an arrow key or Space. Esc cancels capture; Tab moves to the next control. Changes stay in draft until saved. Right-click movement is unchanged.</p><div class="binding-rows" data-binding-rows></div><p role="status" aria-live="polite" data-binding-status></p><button type="button" data-binding-swap hidden></button><div class="binding-actions"><button type="button" data-binding-defaults>Restore defaults</button><button type="button" data-binding-cancel>Cancel</button><button type="button" data-binding-save>Save &amp; apply</button></div>';
  dialog.setAttribute('aria-labelledby','keyboard-title');dialog.setAttribute('aria-describedby','keyboard-instructions');
  const find=<T extends HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
  const rows=find('[data-binding-rows]'),status=find('[data-binding-status]'),swap=find<HTMLButtonElement>('[data-binding-swap]');
  const abort=new AbortController(),options={signal:abort.signal};
  const buttons=new Map<BindingAction,HTMLButtonElement>();
  let open=false,disposed=false,conflict:{target:BindingAction;other:BindingAction;key:string}|null=null;
  let returnFocus:HTMLElement|null=null;
  const say=(message:string)=>{status.textContent=message;};
  function render(){
    for(const [action,button] of buttons){
      button.textContent=bindings.captureAction===action?'Press a key…':bindingLabel(bindings.draft[action]);
      button.setAttribute('aria-label',`${names[action]}: ${bindingLabel(bindings.draft[action])}. Change key`);
      button.setAttribute('aria-pressed',String(bindings.captureAction===action));
    }
    swap.hidden=conflict===null;
    if(conflict)swap.textContent=`Swap ${names[conflict.target]} and ${names[conflict.other]}`;
  }
  function stopCapture(){bindings.cancelCapture();render();}
  function close(cancel:boolean,restoreFocus=true){
    if(!open)return;
    if(cancel)bindings.cancel();else bindings.cancelCapture();
    conflict=null;open=false;dialog.close();onOpenChange(false);
    if(restoreFocus&&returnFocus?.isConnected)returnFocus.focus();
  }
  for(const action of BINDING_ACTIONS){
    const row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');
    row.className='binding-row';name.textContent=names[action];button.type='button';button.dataset['bindingAction']=action;
    button.addEventListener('click',()=>{if(!open)return;conflict=null;bindings.beginCapture(action);say(`Press a new key for ${names[action]}. Esc cancels capture.`);render();},options);
    button.addEventListener('blur',()=>{if(bindings.captureAction===action){stopCapture();if(!conflict)say('Key capture cancelled. Draft changes are kept.');}},options);
    buttons.set(action,button);row.append(name,button);rows.append(row);
  }
  trigger.addEventListener('click',()=>{
    if(disposed||open)return;
    returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:trigger;
    const initialNotice=bindings.notice;bindings.cancel();conflict=null;open=true;onOpenChange(true);
    render();say(initialNotice||'Current keys are shown. Changes apply only after saving.');
    try{dialog.showModal();buttons.get('Q')!.focus();}
    catch(error){close(true);throw error;}
  },options);
  dialog.addEventListener('keydown',event=>{
    if(!open)return;
    const action=bindings.captureAction;
    if(event.key==='Tab'){
      if(action){stopCapture();say('Key capture cancelled. Draft changes are kept.');}
      // Native dialog keeps focus inside; explicitly wrap endpoints for predictable keyboard navigation.
      const available=[...dialog.querySelectorAll<HTMLButtonElement>('button')].filter(button=>!button.hidden&&!button.disabled);
      const first=available[0],last=available.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      return;
    }
    if(action&&event.target===buttons.get(action)){
      event.preventDefault();event.stopPropagation();
      const result=bindings.capture(event);
      if(result.ok){conflict=null;say(`${names[action]}: ${bindingLabel(bindings.draft[action])}. Not saved yet.`);}
      else if(result.reason==='conflict'){
        conflict={target:action,other:result.action,key:bindings.draft[result.action]};
        say(`${bindingLabel(conflict.key)} is already used by ${names[result.action]}. Choose another key, or explicitly swap the two actions.`);
      }else if(result.reason==='cancelled'){conflict=null;say('Key capture cancelled. Draft changes are kept.');}
      else if(result.reason==='unsupported-key')say('Use A–Z, 0–9, an arrow key or Space. Esc, Tab and Enter stay reserved for navigation.');
      render();return;
    }
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!event.repeat&&!event.isComposing)close(true);}
  },{...options,capture:true});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(bindings.captureAction){stopCapture();conflict=null;render();say('Key capture cancelled. Draft changes are kept.');}else close(true);},options);
  // A native/programmatic dismissal must not leave gameplay disabled or commit a draft.
  dialog.addEventListener('close',()=>{if(open&&!dialog.open)close(true);},options);
  swap.addEventListener('click',()=>{
    if(!open||!conflict)return;
    const result=bindings.edit(conflict.target,conflict.key,'swap');
    if(result.ok){bindings.cancelCapture();conflict=null;say('Keys swapped in the draft. Save & apply to use them.');render();find<HTMLButtonElement>('[data-binding-save]').focus();}
  },options);
  find('[data-binding-defaults]').addEventListener('click',()=>{if(!open)return;bindings.defaults();conflict=null;render();say(bindings.notice);},options);
  find('[data-binding-cancel]').addEventListener('click',()=>close(true),options);
  find('[data-binding-save]').addEventListener('click',()=>{
    if(!open)return;
    if(conflict){say('Resolve the key conflict by choosing another key or swapping, or Cancel to discard the draft.');return;}
    if(!bindings.apply()){say(bindings.notice);return;}
    onApplied();close(false);
  },options);
  function interruptCapture(reason:string){if(open){bindings.cancelCapture();conflict=null;render();say(`Key capture cancelled ${reason}. Draft changes are kept.`);}}
  window.addEventListener('blur',()=>interruptCapture('on window blur'),options);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interruptCapture('while hidden');},options);
  trigger.disabled=false;
  return {get isOpen(){return open;},dispose(){if(disposed)return;disposed=true;abort.abort();if(open){bindings.cancel();open=false;dialog.close();}trigger.disabled=true;dialog.replaceChildren();}};
}
