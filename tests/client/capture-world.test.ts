import {afterEach,describe,expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {createWorld} from '../../src/render/world.js';
import {getContent} from '../../src/content/catalog.js';
import {makeSim} from '../helpers.js';
const doubles=vi.hoisted(()=>({renderer:null as any,presentation:null as any,battlefield:null as any}));
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return {...actual,TextureLoader:class {async loadAsync(){return new actual.Texture();}},WebGLRenderer:class {
    ratio=1;domElement={width:0,height:0,tabIndex:-1,remove:vi.fn()};shadowMap={};toneMapping=0;toneMappingExposure=1;
    info={render:{calls:1,triangles:10},memory:{geometries:2,textures:3}};
    render=vi.fn();dispose=vi.fn();forceContextLoss=vi.fn();getContext=()=>({});
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
    world.sync(sim.snapshot(),player.id);world.draw(1/60,.5);
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
});
