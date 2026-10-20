import { describe, expect, it } from 'vitest';
import { Rng, hash2 } from '../../src/sim/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    expect(new Rng(1).next()).not.toEqual(new Rng(2).next());
  });

  it('stays in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
    }
  });

  it('is roughly uniform', () => {
    const r = new Rng(99);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(r.next() * 10)]!++;
    for (const b of buckets) expect(Math.abs(b - 10_000)).toBeLessThan(500);
  });

  it('forks into stable independent streams', () => {
    const f1 = new Rng(5).fork(1);
    const f2 = new Rng(5).fork(1);
    const f3 = new Rng(5).fork(2);
    const v1 = f1.next();
    expect(v1).toEqual(f2.next());
    expect(v1).not.toEqual(f3.next());
  });

  it('hash2 is stable', () => {
    expect(hash2(1, 2)).toEqual(hash2(1, 2));
    expect(hash2(1, 2)).not.toEqual(hash2(2, 1));
  });
});
