import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {parseCaptureConfig,WARMUP_FRAMES} from '../../src/capture/config.js';
import {CaptureSession,type CaptureConsumer} from '../../src/capture/session.js';
import {CaptureLifetime} from '../../src/capture/lifetime.js';
import {classifyRenderer,rendererEvidence} from '../../src/capture/renderer.js';
import {copyCaptureView,applyCapturePose} from '../../src/render/capture-view.js';
import {CAMERAS,CAPTURE_SIZE} from '../../src/capture/cameras.js';
import {Simulation} from '../../src/sim/simulation.js';
import {HeroBot} from '../../src/sim/ai.js';
import {testNavigation} from '../helpers.js';
const config=(query='')=>parseCaptureConfig(`?shot=gameplay${query}`)!;
const consumer=():CaptureConsumer=>({sync:vi.fn(),draw:vi.fn(),renderOnly:vi.fn()});

describe('capture request boundary',()=>{
  it('requires explicit shot and keeps unrelated normal URL parameters inert',()=>{expect(parseCaptureConfig('?seed=1&t=10&frames=12')).toBeNull();expect(config()).toMatchObject({seed:1,startFrame:600,frames:1,input:'march'});});
  it.each(['?shot=__proto__','?shot=','?shot=spawn&shot=spawn','?shot=spawn&seed=-1','?shot=spawn&seed=4294967296','?shot=spawn&seed=1.5','?shot=spawn&t=Infinity','?shot=spawn&t=121','?shot=spawn&t=','?shot=spawn&frames=0','?shot=spawn&frames=3601','?shot=spawn&input=teleport'])('rejects malformed input %s',query=>expect(()=>parseCaptureConfig(query)).toThrow());
  it('reports requested time and rounded 60 Hz sample separately',()=>expect(config('&t=0.02&seed=0')).toMatchObject({requestedTime:.02,startFrame:1,seed:0}));
});
describe('renderer identity',()=>{
  it.each([['ANGLE (Google, Vulkan SwiftShader Device)','software'],['llvmpipe (LLVM)','software'],['NVIDIA GeForce RTX','gpu'],['ANGLE (Intel, UHD Graphics)','gpu'],['Apple M3','gpu'],['ANGLE (VMware, NVIDIA)','unknown'],['WebKit WebGL','unknown'],['','unknown']])('classifies %s conservatively',(raw,expected)=>expect(classifyRenderer(raw)).toBe(expected));
  it('retains raw masked report and unknown when debug extension is unavailable',()=>{const gl={isContextLost:()=>false,getExtension:()=>null,getParameter:(key:number)=>key===1?'WebKit WebGL':'masked',RENDERER:1,VENDOR:2,VERSION:3};expect(rendererEvidence(gl as unknown as WebGL2RenderingContext)).toMatchObject({renderer:'WebKit WebGL',rendererClass:'unknown',unmasked:false});});
});
describe('capture camera adapter',()=>{
  it('copies explicit settings and leaves a camera untouched until opt-in',()=>{const camera=new THREE.PerspectiveCamera(45,16/9,.1,200),original=camera.position.clone();const view=copyCaptureView({...CAPTURE_SIZE,pixelRatio:1,pose:CAMERAS.spawn.pose});expect(camera.position).toEqual(original);expect(view.pose).not.toBe(CAMERAS.spawn.pose);applyCapturePose(camera,view.pose!);expect(camera.position.toArray()).toEqual([-94,24,19.2]);expect(camera.fov).toBe(45);});
  it('rejects invalid settings before camera application',()=>{expect(()=>copyCaptureView({...CAPTURE_SIZE,pixelRatio:NaN,pose:null})).toThrow();expect(()=>copyCaptureView({...CAPTURE_SIZE,pixelRatio:1,pose:{...CAMERAS.spawn.pose,fov:180}})).toThrow();});
});
describe('virtual capture consumer',()=>{
  it('matches the real simulation/bot and tape, syncs every tick and warms only the renderer',async()=>{
    const nav=await testNavigation(),session=new CaptureSession(config('&t=10&frames=3'),nav),view=consumer();
    await session.prepare(view);
    expect(session.metadata).toMatchObject({simTick:300,virtualFrame:600,t:10,frame:0,complete:false});
    expect(view.sync).toHaveBeenCalledTimes(301);expect(view.draw).toHaveBeenCalledTimes(601);expect(view.renderOnly).toHaveBeenCalledTimes(WARMUP_FRAMES);
    expect(vi.mocked(view.draw).mock.calls.slice(1).every(([dt,,render])=>dt===1/60&&!render)).toBe(true);
    const direct=new Simulation({seed:1,contentVersion:11,navigation:nav,heroesPerTeam:1,heroIdsByTeam:[['veyra'],['veyra']]}),bot=new HeroBot({team:1,slotIndex:0,difficulty:'normal',seed:1002});
    for(let tick=0;tick<300;tick++)direct.step([...(tick===0?[{type:'move' as const,heroId:direct.getHero(0,0)!.id,point:{x:-18,z:1.2}}]:[]),...bot.think(direct)]);
    expect(session.metadata.stateHash).toBe(direct.finalHash());
    const hash=session.metadata.stateHash;expect(session.next(view,0)).toBe(true);expect(session.metadata.simTick).toBe(300);expect(session.metadata.stateHash).toBe(hash);
    expect(()=>session.next(view,0)).toThrow('Stale');expect(session.next(view,1)).toBe(true);expect(session.metadata.simTick).toBe(301);expect(session.next(view,2)).toBe(false);
    expect(vi.mocked(view.draw).mock.calls.at(-1)).toEqual([1/60,0,true]);
  });
  it('repeats across async yields, seeds and idle input; zero time does not tick',async()=>{
    const nav=await testNavigation(),a=new CaptureSession(config('&t=2&seed=7&input=idle'),nav),b=new CaptureSession(config('&t=2&seed=7&input=idle'),nav);
    await a.prepare(consumer());await b.prepare(consumer(),async()=>{await Promise.resolve();});expect(a.metadata).toEqual(b.metadata);
    const zero=new CaptureSession(config('&t=0'),nav),view=consumer();expect(()=>zero.next(view)).toThrow('not prepared');await zero.prepare(view);expect(zero.metadata.simTick).toBe(0);expect(view.draw).toHaveBeenCalledTimes(1);await expect(zero.prepare(view)).rejects.toThrow('already');
  });
  it('cancellation during pre-roll prevents later rendering',async()=>{const life=new CaptureLifetime(),session=new CaptureSession(config('&t=2'),await testNavigation(),life),view=consumer();await expect(session.prepare(view,async()=>{life.dispose();})).rejects.toThrow('cancelled');expect(view.renderOnly).not.toHaveBeenCalled();expect(()=>session.next(view)).toThrow('cancelled');});
});
describe('capture resource lifetime',()=>{
  it('releases in reverse, including when one resource fails; exactly once',()=>{const life=new CaptureLifetime(),order:number[]=[];life.own(1,n=>order.push(n));life.own(2,n=>{order.push(n);throw new Error('failure');});life.own(3,n=>order.push(n));expect(life.dispose()).toHaveLength(1);expect(order).toEqual([3,2,1]);expect(life.dispose()).toEqual([]);});
  it('releases an async resource that arrived after cancellation',()=>{const life=new CaptureLifetime(),release=vi.fn();life.dispose();expect(()=>life.own({},release)).toThrow('cancelled');expect(release).toHaveBeenCalledTimes(1);});
});
