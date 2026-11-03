// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
let createSavePanel: typeof import('../../src/save/browser.js').createSavePanel;
beforeAll(async()=>{vi.stubGlobal('__MOBA_SAVE_COMPATIBILITY__','layout-test');({createSavePanel}=await import('../../src/save/browser.js'));});
afterEach(()=>{document.body.replaceChildren();localStorage.clear();});
describe('recovery and local-save layout ownership',()=>{
  for(const entry of ['index.html','candidate.html'])it(`${entry} keeps recovery and save siblings across restart without touching checkpoints`,()=>{
    const html=readFileSync(resolve(entry),'utf8');
    document.body.innerHTML=new DOMParser().parseFromString(html,'text/html').body.innerHTML;
    const dock=document.querySelector('.runtime-status')!;const notice=document.getElementById('notice')!;
    expect(notice.parentElement).toBe(dock);
    for(const oldSave of [null,'existing checkpoint bytes']){
      if(oldSave!==null)localStorage.setItem('checkpoint',oldSave);
      for(let cycle=0;cycle<2;cycle++){
        const panel=createSavePanel();panel.say('Long save status '.repeat(30));
        expect(dock.querySelectorAll('.local-save')).toHaveLength(1);
        expect(notice.nextElementSibling).toBe(dock.querySelector('.local-save'));
        const leaked=vi.fn();window.addEventListener('keydown',leaked);
        for(const key of [' ','s','q']){const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});dock.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);}
        expect(leaked).not.toHaveBeenCalled();
        expect(panel.button.type).toBe('button');expect(dock.querySelector('[role="status"]')).not.toBeNull();
        notice.dataset.recovery='true';notice.hidden=false;
        expect(notice.getAttribute('role')).toBe('alert');
        panel.dispose();dock.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));expect(leaked).toHaveBeenCalledTimes(1);window.removeEventListener('keydown',leaked);expect(dock.querySelector('.local-save')).toBeNull();expect(document.getElementById('notice')).toBe(notice);
        expect(localStorage.getItem('checkpoint')).toBe(oldSave);
      }
    }
  });
  it('retains standalone save-panel mounting when no production dock exists',()=>{const p=createSavePanel();expect(document.body.querySelector('.local-save')).not.toBeNull();p.dispose();expect(document.body.children).toHaveLength(0);});
});
