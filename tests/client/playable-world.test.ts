// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {createPlayableWorld,MINIMUM_ACCEPTANCE_TICKS} from '../../src/render/playable-world.js';
import {createCanvasWorld} from '../../src/render/canvas-world.js';
import {getContent} from '../../src/content/catalog.js';
import {readFile} from 'node:fs/promises';
import {Simulation} from '../../src/sim/simulation.js';
import {createDetourNavigation} from '../../src/sim/navigation.js';
const options=()=>({search:'?camera=hold-follow-v1',defaultLightingSearch:'?lighting=forest-light-v1',cameraFollow:'hold-follow-v1' as const,signal:new AbortController().signal});
it('initialization failure retries default rendering and reports the downgrade',async()=>{
 const webgl=vi.fn().mockRejectedValueOnce(new Error('asset failure')).mockResolvedValueOnce({dispose:vi.fn()});const canvas=vi.fn();
 const result=await createPlayableWorld(document.createElement('main'),getContent(12),options(),{webgl,canvas} as any);
 expect(webgl.mock.calls[1]![2]).toMatchObject({lighting:'forest-light-v1',cameraFollow:'baseline'});expect(canvas).not.toHaveBeenCalled();expect(result.fallbackReason).toContain('asset failure');expect(result.cameraPolicy).toBe('baseline');
});
it('both WebGL failures select Canvas2D while abort never creates a fallback owner',async()=>{
 const webgl=vi.fn().mockRejectedValue(new Error('no WebGL2')),canvas=vi.fn().mockReturnValue({});
 const result=await createPlayableWorld(document.createElement('main'),getContent(12),options(),{webgl,canvas} as any);expect(result.backend).toBe('canvas2d');expect(canvas).toHaveBeenCalledTimes(1);
 const o=options(),controller=new AbortController();o.signal=controller.signal;controller.abort();await expect(createPlayableWorld(document.createElement('main'),getContent(12),o,{webgl,canvas} as any)).rejects.toMatchObject({name:'AbortError'});expect(canvas).toHaveBeenCalledTimes(1);
});
it('explicit Canvas2D avoids WebGL and keeps the normal simulation alive for 300 ticks',async()=>{
 const context={fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fill:vi.fn(),fillText:vi.fn()};
 const spy=vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as any);
 const host=document.createElement('main');document.body.append(host);const world=createCanvasWorld(host,getContent(12));const nav=await createDetourNavigation(await readFile('src/sim/nav/lane.navmesh'));const sim=new Simulation({seed:1,contentVersion:12,navigation:nav});const player=sim.getHero(0,0)!;
 for(let i=0;i<MINIMUM_ACCEPTANCE_TICKS;i++){sim.step([]);world.sync(sim.snapshot(),player.id);world.draw(1/30);}
 expect(sim.state.tick).toBe(300);expect(context.arc).toHaveBeenCalled();world.setLocked(false);expect(world.cameraState().locked).toBe(false);world.dispose();expect(host.children.length).toBe(0);spy.mockRestore();host.remove();nav.destroy();
 const webgl=vi.fn(),canvas=vi.fn().mockReturnValue({});await createPlayableWorld(document.createElement('main'),getContent(12),{...options(),search:'?renderer=canvas2d'},{webgl,canvas} as any);expect(webgl).not.toHaveBeenCalled();
});
