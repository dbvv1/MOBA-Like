import {describe,it,expect} from 'vitest';
import {parseCaptureConfig,captureArtifactIdentity,STANDARD_POSE,STANDARD_SHOT} from '../../src/capture/config.js';
import {CAMERAS} from '../../src/capture/cameras.js';

describe('explicit standards capture identity',()=>{
 it('keeps normal four-camera configuration and labels unchanged',()=>{
  for(const shot of Object.keys(CAMERAS)){
   const config=parseCaptureConfig(`?shot=${shot}`)!;
   expect(config.shot).toBe(shot);expect(config).not.toHaveProperty('standards');
   expect(captureArtifactIdentity(config)).toEqual({captureRole:'gameplay'});
  }
  expect(Object.keys(CAMERAS)).toHaveLength(4);
 });
 it('identifies the same-frame source set separately from its internal spawn setup',()=>{
  const config=parseCaptureConfig('?shot=spawn&standards=quiet-five-v1')!;
  expect(config.standards).toBe('quiet-five-v1');expect(captureArtifactIdentity(config)).toEqual({captureRole:'content-standards',standardsName:'quiet-five-v1',shot:STANDARD_SHOT,requestedGameplayShot:'spawn'});
  expect(Object.hasOwn(CAMERAS,STANDARD_SHOT)).toBe(false);
  expect(STANDARD_POSE).toEqual({position:{x:0,y:24,z:18},target:{x:0,y:0,z:0},fov:45});
 });
 it.each(['?standards=quiet-five-v1','?shot=spawn&standards=','?shot=spawn&standards=unknown','?shot=spawn&standards=quiet-five-v1&standards=quiet-five-v1','?shot=gameplay&standards=quiet-five-v1','?shot=all&standards=quiet-five-v1'])('rejects ambiguous standards request %s',query=>expect(()=>parseCaptureConfig(query)).toThrow());
});
