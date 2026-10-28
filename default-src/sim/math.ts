import type { Vec2 } from '../content/types.js';

export const EPSILON = 1e-9;

export function vec(x: number, z: number): Vec2 {
  return { x, z };
}

export function copyVec(v: Vec2): Vec2 {
  return { x: v.x, z: v.z };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function scale(v: Vec2, factor: number): Vec2 {
  return { x: v.x * factor, z: v.z * factor };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.z * b.z;
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.z);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distanceSquared(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len <= EPSILON) {
    return { x: 1, z: 0 };
  }
  return { x: v.x / len, z: v.z / len };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function moveTowards(from: Vec2, to: Vec2, maxDistance: number): Vec2 {
  const delta = sub(to, from);
  const dist = length(delta);
  if (dist <= maxDistance || dist <= EPSILON) {
    return copyVec(to);
  }
  return add(from, scale(delta, maxDistance / dist));
}

export function rotate(v: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

export function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

export function fromAngle(radians: number): Vec2 {
  return { x: Math.cos(radians), z: Math.sin(radians) };
}

/** Closest distance from a point to a finite segment. */
export function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  if (denom <= EPSILON) {
    return distance(point, a);
  }
  const t = clamp(dot(sub(point, a), ab) / denom, 0, 1);
  const closest = add(a, scale(ab, t));
  return distance(point, closest);
}

export function projectPointOnSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const denom = dot(ab, ab);
  if (denom <= EPSILON) {
    return 0;
  }
  return clamp(dot(sub(point, a), ab) / denom, 0, 1);
}

export function isFiniteVec(v: Vec2 | null | undefined): v is Vec2 {
  return Boolean(v && Number.isFinite(v.x) && Number.isFinite(v.z));
}
