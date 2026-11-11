import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {createMotion} from '../../asset-pipeline/presentation/motion.js';
import {VEYRA_MOTION_OPTIONS} from '../../src/render/hero-presentation.js';
import manifest from '../../asset-pipeline/veyra-death-contact/canonical/manifest.json';
import {readVeyraBaseline} from '../veyra-baseline.js';

const baseline=await readVeyraBaseline();
const parse=(bytes:Buffer)=>new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
const read=(path:string)=>readFile(new URL(`../../${path}`,import.meta.url));

describe('canonical 4.3 recipe exports in the existing combat trial',()=>{
  it.each(['teal','rust'])('%s preserves original non-death tracks and matches accepted death through the real mixer',async team=>{
    const entry=manifest.assets.find(row=>row.id===`veyra-${team}`)!;
    const bytes=await read(entry.file);
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    const canonical=await parse(bytes),original=await parse(baseline.get(`exported/veyra-${team}.glb`)!);
    const received=await parse(await read(`asset-pipeline/veyra-death-contact/exported/veyra-${team}.glb`));
    expect(canonical.animations.map(clip=>clip.name).sort()).toEqual(['attack','death','hurt','idle','walk']);
    for(const name of ['idle','walk','attack','hurt']){
      const actual=canonical.animations.find(clip=>clip.name===name)!;
      const expected=original.animations.find(clip=>clip.name===name)!;
      expect(actual.duration).toBe(expected.duration);
      expect(actual.tracks.map(track=>track.name)).toEqual(expected.tracks.map(track=>track.name));
      actual.tracks.forEach((track,index)=>{
        expect(track.getInterpolation()).toBe(expected.tracks[index]!.getInterpolation());
        expect(track.times).toEqual(expected.tracks[index]!.times);
        expect(track.values).toEqual(expected.tracks[index]!.values);
      });
    }
    const root=clone(canonical.scene),reference=clone(received.scene);
    const motion=createMotion(root,canonical,VEYRA_MOTION_OPTIONS),accepted=createMotion(reference,received,VEYRA_MOTION_OPTIONS);
    const matrices=(node:typeof root)=>{
      node.updateMatrixWorld(true);const values=new Map<string,number[]>();
      node.traverse(bone=>{if(bone.type==='Bone')values.set(bone.name,bone.matrixWorld.toArray());});return values;
    };
    try{
      expect(motion.deathDuration).toBe(accepted.deathDuration);
      // 61 source contact samples plus a late frozen sample, through production
      // createMotion (including its shifted first frame), not a second animator.
      for(const elapsed of [...Array.from({length:61},(_,i)=>i/60),10]){
        motion.sample({time:elapsed,deathElapsed:elapsed});accepted.sample({time:elapsed,deathElapsed:elapsed});
        expect(motion.inspect().map((action:{clip:string})=>action.clip)).toEqual(['death.full']);
        const actual=matrices(root),expected=matrices(reference);
        expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
        for(const [name,values] of actual)values.forEach((value,index)=>expect(value,`${team}/${elapsed}/${name}/${index}`).toBeCloseTo(expected.get(name)![index]!,6));
      }
      motion.reset();motion.sample({time:0});
      expect(motion.inspect().map((action:{clip:string})=>action.clip).sort()).toEqual(['idle.lower','idle.upper']);
    }finally{motion.dispose();accepted.dispose();}
  });
});
