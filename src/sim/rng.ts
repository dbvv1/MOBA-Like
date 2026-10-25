/**
 * Small deterministic PRNG. The whole generator state is one uint32, which is
 * included in the match hash so a replay can prove it consumed random draws in
 * the same order.
 */
export class SeededRng {
  state: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.state = normalized === 0 ? 0x9e3779b9 : normalized;
  }

  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error('cannot pick from an empty array');
    }
    return values[this.int(values.length)] as T;
  }
}

export function deriveSeed(seed: number, stream: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (stream + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}
