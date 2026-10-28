import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSaveOwnership} from '../../src/save/ownership.js';
import {createAsyncLockManager} from './save-locks.js';

afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function loadOwnership(locks:Pick<LockManager,'request'>){
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('__MOBA_SAVE_COMPATIBILITY__','test-rules');
  return (await import('../../src/save/browser.js')).acquireSaveOwnership;
}

describe('save ownership handoff',()=>{
  it('waits for native release completion before the same tab requests a new owner',async()=>{
    const manager=createAsyncLockManager(),acquire=await loadOwnership(manager.locks);
    const first=await acquire();expect(first).not.toBeNull();
    first!();
    const second=acquire();
    await vi.waitFor(()=>expect(manager.releasing).toBe(1));
    expect(manager.requests).toHaveLength(1);
    manager.finishRelease();
    const release=await second;expect(release).not.toBeNull();expect(manager.requests).toHaveLength(2);
    release!();await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
  });
  it('keeps a second tab read-only instead of waiting for its live owner',async()=>{
    const manager=createAsyncLockManager();
    const firstTab=createSaveOwnership(()=>manager.locks),secondTab=createSaveOwnership(()=>manager.locks);
    const release=await firstTab();
    expect(await secondTab()).toBeNull();expect(manager.held).toBe(true);
    release!();await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
  });
  it('does not steal a lock acquired by another tab during the handoff',async()=>{
    const manager=createAsyncLockManager();
    const firstTab=createSaveOwnership(()=>manager.locks),secondTab=createSaveOwnership(()=>manager.locks);
    const release=await firstTab();release!();const replacement=firstTab();
    await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
    const otherRelease=await secondTab();expect(otherRelease).not.toBeNull();
    expect(await replacement).toBeNull();
    otherRelease!();await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
  });
  it('cancels a handoff wait promptly without acquiring or dropping the release barrier',async()=>{
    const manager=createAsyncLockManager(),acquire=createSaveOwnership(()=>manager.locks);
    const release=await acquire();release!();
    const aborted=new AbortController(),abandoned=acquire(aborted.signal);aborted.abort();
    expect(await abandoned).toBeNull();expect(manager.requests).toHaveLength(1);
    const replacement=acquire();await vi.waitFor(()=>expect(manager.releasing).toBe(1));
    expect(manager.requests).toHaveLength(1);manager.finishRelease();
    const next=await replacement;expect(next).not.toBeNull();
    next!();await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
  });
  it('drains a cancelled, not-yet-delivered grant before a newer boot requests ownership',async()=>{
    const manager=createAsyncLockManager(),acquire=createSaveOwnership(()=>manager.locks);
    manager.pauseCallbacks(true);
    const controller=new AbortController(),abandoned=acquire(controller.signal);
    expect(manager.pendingCallbacks).toBe(1);controller.abort();expect(await abandoned).toBeNull();
    const replacement=acquire();expect(manager.requests).toHaveLength(1);
    manager.pauseCallbacks(false);manager.deliverCallback();
    await vi.waitFor(()=>expect(manager.releasing).toBe(1));expect(manager.requests).toHaveLength(1);
    manager.finishRelease();const release=await replacement;expect(release).not.toBeNull();
    release!();await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
  });
  it('supports rapid repeats, double cleanup and cancellation of the current owner',async()=>{
    const manager=createAsyncLockManager(),acquire=createSaveOwnership(()=>manager.locks);
    const controller=new AbortController();let release=await acquire(controller.signal);
    for(let cycle=0;cycle<3;cycle++){
      if(cycle===0)controller.abort();
      release!();release!();const next=acquire();
      await vi.waitFor(()=>expect(manager.releasing).toBe(1));
      expect(manager.requests).toHaveLength(cycle+1);manager.finishRelease();
      release=await next;expect(release).not.toBeNull();expect(manager.held).toBe(true);
    }
    release!();await vi.waitFor(()=>expect(manager.releasing).toBe(1));manager.finishRelease();
  });
  it('does not request a lock for an already cancelled boot',async()=>{
    const manager=createAsyncLockManager(),acquire=createSaveOwnership(()=>manager.locks);
    const controller=new AbortController();controller.abort();
    expect(await acquire(controller.signal)).toBeNull();expect(manager.requests).toHaveLength(0);
  });
  it('fails closed for unsupported, inaccessible and rejected Web Locks',async()=>{
    expect(await createSaveOwnership(()=>undefined)()).toBeNull();
    expect(await createSaveOwnership(()=>{throw new Error('inaccessible');})()).toBeNull();
    for(const request of [()=>{throw new Error('sync rejection');},()=>Promise.reject(new Error('async rejection'))]){
      const acquire=createSaveOwnership(()=>({request} as Pick<LockManager,'request'>));
      expect(await acquire()).toBeNull();expect(await acquire()).toBeNull();
    }
  });
});
