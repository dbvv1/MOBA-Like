import type {ReadSave} from './storage.js';
import {createSaveOwnership} from './ownership.js';
import './panel.css';

declare const __MOBA_SAVE_COMPATIBILITY__:string;
export const SAVE_COMPATIBILITY_ID=__MOBA_SAVE_COMPATIBILITY__;

/** Native lock prevents two tabs from racing a read/modify/write Web Storage transaction. */
export const acquireSaveOwnership=createSaveOwnership(()=>navigator.locks);

export function createSavePanel(){
  const root=document.createElement('aside');root.className='local-save';root.setAttribute('aria-label','Local match save');
  const button=document.createElement('button');button.type='button';button.textContent='Save match';button.disabled=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Preparing local save…';
  // Native Space/Enter on the save button must not trigger gameplay shortcuts.
  root.addEventListener('keydown',event=>event.stopPropagation());
  root.append(button,status);document.body.append(root);
  return {button,say(text:string){status.textContent=text;},dispose(){root.remove();}};
}

export async function chooseSavedMatch(read:Exclude<ReadSave,{status:'empty'}>,signal?:AbortSignal):Promise<'resume'|'new'|'preserve'>{
  if(signal?.aborted)throw new DOMException('Saved match choice cancelled.','AbortError');
  const dialog=document.createElement('dialog');dialog.className='local-save-choice';
  dialog.setAttribute('aria-labelledby','local-save-title');
  const heading=document.createElement('h2');heading.id='local-save-title';heading.textContent=read.status==='ready'?'Continue your match?':'Saved match unavailable';
  const description=document.createElement('p');
  description.textContent=read.status==='ready'
    ?`A local checkpoint at ${Math.floor(read.save.tick/30/60)}:${String(Math.floor(read.save.tick/30)%60).padStart(2,'0')} is ready. Continue that match, or replace it with a new one. Only this browser keeps the save.`
    :read.status==='incompatible'?'This save uses a different rules version. It has not been changed.':read.status==='unavailable'?'Browser storage cannot be read. You can still play without saving.':'This save could not be read safely. Its original bytes have been kept.';
  const actions=document.createElement('div');actions.className='local-save-actions';dialog.append(heading,description,actions);document.body.append(dialog);
  return new Promise((resolve,reject)=>{
    let settled=false;
    const remove=()=>{signal?.removeEventListener('abort',cancel);dialog.close();dialog.remove();};
    const cancel=()=>{if(settled)return;settled=true;remove();reject(new DOMException('Saved match choice cancelled.','AbortError'));};
    const finish=(choice:'resume'|'new'|'preserve')=>{if(settled)return;settled=true;remove();resolve(choice);};
    const action=(label:string,choice:'resume'|'new'|'preserve')=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>finish(choice),{once:true});actions.append(button);};
    if(read.status==='ready')action('Continue saved match','resume');
    if(read.status!=='unavailable')action('New match · replace save','new');
    action('Play without saving · keep old save','preserve');
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('preserve');},{once:true});
    signal?.addEventListener('abort',cancel,{once:true});
    dialog.showModal();
  });
}
