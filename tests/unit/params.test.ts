import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, parseParams } from '../../src/core/params';

describe('parseParams', () => {
  it('returns defaults for empty query', () => {
    expect(parseParams('')).toEqual(DEFAULT_PARAMS);
  });

  it('parses valid values', () => {
    expect(parseParams('?scene=test&seed=12&cam=free&t=2.5&debug=1')).toEqual({
      scene: 'test',
      seed: 12,
      cam: 'free',
      freezeAt: 2.5,
      debug: true,
      camPos: null,
      camLook: null,
      mech: 'ironclaw',
      walk: 0,
      turn: 0,
      fire: 0,
      mode: 'range',
    });
  });

  it('parses camera pose vectors', () => {
    const p = parseParams('?pos=1,2.5,-3&look=0,0');
    expect(p.camPos).toEqual([1, 2.5, -3]);
    expect(p.camLook).toBeNull();
  });

  it('rejects invalid values', () => {
    const p = parseParams('?scene=moon&seed=abc&cam=drone&t=-1');
    expect(p.scene).toBe(DEFAULT_PARAMS.scene);
    expect(p.seed).toBe(DEFAULT_PARAMS.seed);
    expect(p.cam).toBe(DEFAULT_PARAMS.cam);
    expect(p.freezeAt).toBeNull();
  });
});
