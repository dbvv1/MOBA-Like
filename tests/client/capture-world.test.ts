import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createWorld} from '../../src/render/world.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim} from '../helpers.js';
import {renderRole} from '../../src/render/lighting-style.js';
const doubles=vi.hoisted(()=>({renderer:null as any,presentation:null as any,battlefield:null as any}));
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return {...actual,TextureLoader:class {async loadAsync(){return new actual.Texture();}},WebGLRenderer:class {
    ratio=1;domElement={width:0,height:0,tabIndex:-1,remove:vi.fn()};shadowMap={};toneMapping=0;toneMappingExposure=1;
    info={render:{frame:0,calls:1,triangles:10},memory:{geometries:2,textures:3}};
    contextLost=false;render=vi.fn(()=>{if(!this.contextLost)this.info.render.frame++;});dispose=vi.fn();forceContextLoss=vi.fn();getContext=()=>({isContextLost:()=>this.contextLost});
    constructor(){doubles.renderer=this;}
    setPixelRatio(ratio:number){this.ratio=ratio;}getPixelRatio(){return this.ratio;}
    setSize(width:number,height:number){this.domElement.width=width*this.ratio;this.domElement.height=height*this.ratio;}
  }};
});
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
afterEach(()=>vi.unstubAllGlobals());
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
