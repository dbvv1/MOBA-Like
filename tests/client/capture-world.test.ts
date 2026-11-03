import {mkdirSync,writeFileSync} from 'node:fs';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createWorld} from '../../src/render/world.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim} from '../helpers.js';
import {renderRole} from '../../src/render/lighting-style.js';
const doubles=vi.hoisted(()=>({failFit:false,standards:null as any,renderer:null as any,presentation:null as any,battlefield:null as any}));
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return {...actual,TextureLoader:class {async loadAsync(){return new actual.Texture();}},WebGLRenderer:class {
    ratio=1;domElement={width:0,height:0,tabIndex:-1,remove:vi.fn()};shadowMap={};toneMapping=0;toneMappingExposure=1;
    info={render:{frame:0,calls:1,triangles:10},memory:{geometries:2,textures:3}};
    contextLost=false;render=vi.fn(()=>{if(!this.contextLost)this.info.render.frame++;});dispose=vi.fn();forceContextLoss=vi.fn();getContext=()=>({isContextLost:()=>this.contextLost});
    constructor(){doubles.renderer=this;}
    setPixelRatio(ratio:number){this.ratio=ratio;}getPixelRatio(){return this.ratio;}
    setSize(width:number,height:number){if(doubles.failFit)throw new Error('fixture fit failed');this.domElement.width=width*this.ratio;this.domElement.height=height*this.ratio;}
  }};
});
vi.mock('../../src/render/terrain-textures.js',()=>({loadTerrainTextures:async()=>({road:new THREE.Texture(),forest:new THREE.Texture(),dispose:vi.fn()})}));
vi.mock('../../src/capture/content-standards.js',()=>({createContentStandards:()=>{const root=new THREE.Group();root.name='quiet-five-v1';const value={root,advance:vi.fn(),inspect:()=>({name:'quiet-five-v1',slotCount:5}),dispose:vi.fn(()=>root.removeFromParent())};doubles.standards=value;return value;}}));
vi.mock('../../src/render/battle-assets.js',()=>({loadBattleAssets:async()=>({models:{},dispose:vi.fn()})}));
vi.mock('../../src/render/combat-textures.js',()=>({loadCombatTextures:async()=>({dispose:vi.fn()})}));
vi.mock('../../asset-pipeline/presentation/adapter.js',()=>({createPresentation:()=>{
  const root=new THREE.Group(),hero=new THREE.Group();hero.name='hero-9';root.add(hero);
  const view={root,sync:vi.fn((snapshot:any)=>{const h=snapshot.heroes[0];hero.name=`hero-${h.id}`;hero.position.set(h.position.x,0,h.position.z);}),advance:vi.fn(),dispose:vi.fn(),motionState:()=>[]};doubles.presentation=view;return view;
}}));
vi.mock('../../src/render/battlefield.js',()=>({createBattlefield:()=>{const view={root:new THREE.Group(),sync:vi.fn(),advance:vi.fn(),dispose:vi.fn()};doubles.battlefield=view;return view;}}));
vi.mock('../../src/render/health.js',()=>({createHealthBars:()=>({sync:vi.fn(),draw:vi.fn(),dispose:vi.fn()})}));
vi.mock('../../src/render/effects.js',()=>({createEffects:()=>({sync:vi.fn(),draw:vi.fn(),inspect:()=>[],dispose:vi.fn()})}));
vi.mock('../../src/render/impact.js',()=>({createImpacts:()=>({sync:vi.fn(),draw:vi.fn(),dispose:vi.fn()})}));
vi.mock('../../src/render/tower-reach.js',()=>({createTowerReach:()=>({sync:vi.fn(),draw:vi.fn(),dispose:vi.fn()})}));
vi.mock('../../src/render/control-state.js',()=>({createControlMarkers:()=>({sync:vi.fn(),draw:vi.fn(),dispose:vi.fn()})}));
vi.mock('../../src/render/targeting.js',()=>({createTargeting:()=>({update:vi.fn(),inspect:()=>[],dispose:vi.fn()}),targetingPlan:()=>null}));
afterEach(()=>{doubles.failFit=false;vi.unstubAllGlobals();});
describe('real world capture wiring with a renderer double',()=>{
  it('preserves default draw; capture restore returns host sizing/lens/focus; warmup does not update consumers',async()=>{
    const remove=vi.fn();vi.stubGlobal('window',{devicePixelRatio:1.5,addEventListener:vi.fn(),removeEventListener:remove});
    const host={clientWidth:800,clientHeight:600,replaceChildren:vi.fn()} as unknown as HTMLElement;
    const world=await createWorld(host,getContent(11)),sim=await makeSim(11),player=sim.getHero(0,0)!;
    expect(world.lightingState()).toMatchObject({requested:'baseline',configured:'baseline',active:null,stage:'configured'});
    world.sync(sim.snapshot(),player.id);world.draw(1/60,.5);
    expect(world.lightingState()).toMatchObject({active:'baseline',stage:'frame-submitted'});
    const baseline=world.captureState();expect(baseline.camera.position).toEqual({x:player.position.x,y:24,z:player.position.z+18});expect(doubles.renderer.render).toHaveBeenCalledTimes(1);
    const pose={position:{x:-65,y:62,z:46.5},target:{x:-65,y:0,z:0},fov:60};
    world.setCaptureView({width:1280,height:720,pixelRatio:1,pose});world.draw(1/60,.5,false);
    expect(doubles.renderer.render).toHaveBeenCalledTimes(1);expect(world.captureState().camera.fov).toBe(60);
    const motions=doubles.presentation.advance.mock.calls.length,terrain=doubles.battlefield.advance.mock.calls.length,hash=sim.finalHash(),state=world.captureState();
    for(let i=0;i<12;i++)world.renderOnly();
    expect(doubles.renderer.render).toHaveBeenCalledTimes(13);expect(doubles.presentation.advance).toHaveBeenCalledTimes(motions);expect(doubles.battlefield.advance).toHaveBeenCalledTimes(terrain);expect(sim.finalHash()).toBe(hash);expect(world.captureState()).toEqual(state);
    world.setCaptureView({width:1280,height:720,pixelRatio:1,pose:null});world.draw(0,.5,false);expect(world.captureState().camera.fov).toBe(45);
    world.setCaptureView(null);expect(world.captureState()).toEqual(baseline);
    world.draw(1/60,.5);expect(doubles.renderer.render).toHaveBeenCalledTimes(14);
    world.dispose();world.dispose();expect(doubles.renderer.dispose).toHaveBeenCalledTimes(1);expect(doubles.renderer.forceContextLoss).toHaveBeenCalledTimes(1);expect(doubles.presentation.dispose).toHaveBeenCalledTimes(1);expect(doubles.battlefield.dispose).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledTimes(1);
  });
  it('wires opt-in environment, preserves output/shadows and records active only after an actual submission',async()=>{
    vi.stubGlobal('window',{devicePixelRatio:1,addEventListener:vi.fn(),removeEventListener:vi.fn()});
    const host={clientWidth:1280,clientHeight:720,replaceChildren:vi.fn()} as unknown as HTMLElement;
    const world=await createWorld(host,getContent(11),{lighting:'stylized-diffuse'});
    expect(world.lightingState()).toMatchObject({requested:'stylized-diffuse',configured:'stylized-diffuse',active:null});
    world.draw(0,0,false);expect(world.lightingState().active).toBeNull();
    doubles.renderer.render.mockImplementationOnce(()=>{throw new Error('fixture render failed');});
    expect(()=>world.renderOnly()).toThrow('fixture render failed');expect(world.lightingState().active).toBeNull();
    doubles.renderer.contextLost=true;world.renderOnly();expect(world.lightingState().active).toBeNull();
    doubles.renderer.contextLost=false;doubles.renderer.render.mockImplementationOnce(()=>{});world.renderOnly();expect(world.lightingState().active).toBeNull();
    world.renderOnly();expect(world.captureState().lighting).toMatchObject({active:'stylized-diffuse',stage:'frame-submitted'});
    const scene=doubles.renderer.render.mock.calls.at(-1)[0] as THREE.Scene;
    expect(scene.children.filter(o=>o instanceof THREE.AmbientLight)).toHaveLength(1);
    expect(scene.children.filter(o=>o instanceof THREE.HemisphereLight)).toHaveLength(1);
    const sun=scene.children.find(o=>o instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    expect(sun.intensity).toBe(2.5);expect(sun.shadow.mapSize.toArray()).toEqual([1024,1024]);expect(sun.shadow.bias).toBe(-.0004);expect(sun.shadow.normalBias).toBe(.035);
    expect(doubles.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);expect(doubles.renderer.toneMappingExposure).toBe(1.12);expect(doubles.renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
    expect(renderRole(doubles.presentation.root)).toBe('world');expect(renderRole(doubles.battlefield.root)).toBe('world');
    const marker=scene.children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh;expect(renderRole(marker)).toBe('cue');expect(marker.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((marker.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    doubles.renderer.contextLost=true;expect(world.lightingState().active).toBeNull();world.dispose();
  });

});

it('actual world follows only while held, releases at current focus, clamps free-scroll and ignores hold in capture',async()=>{
 vi.stubGlobal('window',{devicePixelRatio:1,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const host={clientWidth:800,clientHeight:600,replaceChildren:vi.fn()} as unknown as HTMLElement;
 const world=await createWorld(host,getContent(11),{cameraFollow:'hold-follow-v1'}),sim=await makeSim(11),player=sim.getHero(0,0)!;
 const trace:Array<{phase:string;state:ReturnType<typeof world.cameraState>}>=[];
 const record=(phase:string)=>trace.push({phase,state:world.cameraState()});
 world.sync(sim.snapshot(),player.id);world.draw(0,1,false);world.setLocked(false);record('free-start');
 doubles.renderer.domElement.getBoundingClientRect=()=>({left:0,top:0,width:800,height:600});
 world.setPointer(799,300);world.draw(.25,1,false);record('free-pan');const panned=world.cameraState().position.x;
 world.setFocusHeld(true);world.draw(.25,1,false);record('held');expect(world.cameraState().position.x).toBe(player.position.x);expect(world.cameraState().locked).toBe(false);expect(panned).toBeCloseTo(player.position.x+6);
 // This is the rendered/interpolated root the ordinary world already follows.
 const root=doubles.presentation.root.getObjectByName(`hero-${player.id}`)!;root.position.x+=2;world.draw(.1,.5,false);record('follow-moving-root');expect(world.cameraState().position.x).toBe(player.position.x+2);
 world.setFocusHeld(false);world.leavePointer();world.draw(.1,.5,false);record('release-holds-current-focus');expect(world.cameraState().position.x).toBe(player.position.x+2);
 world.setPointer(799,300);world.draw(.25,.5,false);record('free-resumes-pan');expect(world.cameraState().position.x).toBe(player.position.x+8);
 world.setFocusHeld(true);world.setLocked(true);world.setFocusHeld(false);world.draw(0,1,false);expect(world.cameraState().locked).toBe(true);expect(world.cameraState().temporaryFollow).toBe(false);
 const pose={position:{x:-65,y:62,z:46.5},target:{x:-65,y:0,z:0},fov:60};
 world.setCaptureView({width:1280,height:720,pixelRatio:1,pose});world.setFocusHeld(true);world.draw(.25,1,false);record('fixed-capture');expect(world.cameraState().position).toEqual(pose.position);expect(world.cameraState().temporaryFollow).toBe(false);
 world.setCaptureView(null);expect(world.cameraState().temporaryFollow).toBe(false);
 mkdirSync('outputs/camera-follow',{recursive:true});writeFileSync('outputs/camera-follow/trajectory.json',JSON.stringify({scope:'actual world and Three transforms with renderer/assets doubles; not pixels or playtest',trace},null,2)+'\n');world.dispose();
});


it('failed final fit releases acquired owners and context before retry',async()=>{
 vi.stubGlobal('window',{devicePixelRatio:1,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const host={clientWidth:800,clientHeight:600,replaceChildren:vi.fn()} as unknown as HTMLElement;
 doubles.failFit=true;await expect(createWorld(host,getContent(11))).rejects.toThrow('fixture fit failed');
 const first=doubles.renderer;expect(first.dispose).toHaveBeenCalledTimes(1);expect(first.forceContextLoss).toHaveBeenCalledTimes(1);expect(first.domElement.remove).toHaveBeenCalledTimes(1);expect(doubles.presentation.dispose).toHaveBeenCalledTimes(1);expect(doubles.battlefield.dispose).toHaveBeenCalledTimes(1);
 doubles.failFit=false;const second=await createWorld(host,getContent(11));expect(doubles.renderer).not.toBe(first);second.dispose();expect(first.dispose).toHaveBeenCalledTimes(1);
});

it('capture starts offscreen at 1280x720 DPR 1 and ignores host/window resizing',async()=>{
  const listeners:Record<string,()=>void>={};
  vi.stubGlobal('window',{devicePixelRatio:3,addEventListener:(name:string,fn:()=>void)=>{listeners[name]=fn;},removeEventListener:vi.fn()});
  const host={clientWidth:317,clientHeight:233,replaceChildren:vi.fn()};
  const world=await createWorld(host as unknown as HTMLElement,getContent(11),{cameraFollow:'hold-follow-v1',capture:{width:1280,height:720,pixelRatio:1,pose:null}});
  try{
    world.setFocusHeld(true);expect(world.cameraState().temporaryFollow).toBe(false);
    expect(host.replaceChildren).not.toHaveBeenCalled();expect(world.captureState().viewport).toEqual({width:1280,height:720,pixelRatio:1,bufferWidth:1280,bufferHeight:720});
    host.clientWidth=900;host.clientHeight=500;listeners.resize!();
    expect(world.captureState().viewport).toEqual({width:1280,height:720,pixelRatio:1,bufferWidth:1280,bufferHeight:720});
  }finally{world.dispose();}
});
it('isolates standards from game consumers, waits for submission, restores visibility, and owns teardown once',async()=>{
 vi.stubGlobal('window',{devicePixelRatio:1,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const world=await createWorld({clientWidth:1280,clientHeight:720,replaceChildren:vi.fn()} as unknown as HTMLElement,getContent(11));
 expect(world.captureState().standards).toBeNull();world.setContentStandards(true);world.setContentStandards(true);
 expect(world.captureState().standards).toMatchObject({name:'quiet-five-v1',active:false});
 const sim=await makeSim(11);world.sync(sim.snapshot(),sim.getHero(0)!.id);world.draw(1/60,1,false);
 expect(doubles.presentation.sync).not.toHaveBeenCalled();expect(doubles.presentation.advance).not.toHaveBeenCalled();expect(doubles.standards.advance).toHaveBeenCalledTimes(1);
 world.renderOnly();expect(world.captureState().standards).toMatchObject({active:true});const scene=doubles.renderer.render.mock.calls.at(-1)[0] as THREE.Scene;
 expect(scene.getObjectByName('quiet-five-v1')!.visible).toBe(true);expect(doubles.presentation.root.parent!.visible).toBe(false);
 doubles.renderer.contextLost=true;expect(world.captureState().standards).toMatchObject({active:false});doubles.renderer.contextLost=false;
 sim.step([]);const latest=sim.snapshot();world.sync(latest,sim.getHero(0)!.id);world.setContentStandards(false);expect(doubles.presentation.sync).toHaveBeenCalledWith({...latest,events:[]});expect(doubles.standards.dispose).toHaveBeenCalledTimes(1);expect(world.captureState().standards).toBeNull();expect(doubles.presentation.root.parent!.visible).toBe(true);
 world.sync(sim.snapshot(),sim.getHero(0)!.id);expect(doubles.presentation.sync).toHaveBeenCalledTimes(2);world.setContentStandards(true);const last=doubles.standards;world.dispose();world.dispose();expect(last.dispose).toHaveBeenCalledTimes(1);
});
