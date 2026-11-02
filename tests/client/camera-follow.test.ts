import {expect,it} from 'vitest';
import {cameraFollowPolicy,createCameraFollow} from '../../src/render/camera-follow.js';
it('accepts only the exact opt-in and separates saved lock from temporary ownership',()=>{
  expect(cameraFollowPolicy('?camera=hold-follow-v1')).toBe('hold-follow-v1');
  for(const query of ['', '?camera=unknown','?camera=hold-follow-v1&camera=hold-follow-v1'])expect(cameraFollowPolicy(query)).toBe('baseline');
  const baseline=createCameraFollow();baseline.setLocked(false);baseline.setHeld(true);expect(baseline.following).toBe(false);
  const mode=createCameraFollow('hold-follow-v1');mode.setLocked(false);mode.setHeld(true);
  expect(mode.locked).toBe(false);expect(mode.following).toBe(true);
  mode.setLocked(true);expect(mode.held).toBe(false);mode.setHeld(false);expect(mode.following).toBe(true);
  mode.setLocked(false);mode.setCapture(true);mode.setHeld(true);expect(mode.held).toBe(false);
  mode.setCapture(false);expect(mode.held).toBe(false);expect(mode.following).toBe(false);
});
