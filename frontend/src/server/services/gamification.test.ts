import { describe, expect, it } from 'vitest';
import { levelFromXp, xpForLevel, xpProgress } from './gamification.service';

describe('levelFromXp', () => {
  it('starts at level 1 with no XP', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it('reaches level 2 at 500 XP', () => {
    expect(levelFromXp(500)).toBe(2);
    expect(levelFromXp(499)).toBe(1);
  });

  it('scales linearly at 500 XP per level', () => {
    expect(levelFromXp(1000)).toBe(3);
    expect(levelFromXp(2500)).toBe(6);
  });
});

describe('xpForLevel', () => {
  it('returns the XP threshold that begins a level', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(500);
    expect(xpForLevel(5)).toBe(2000);
  });
});

describe('xpProgress', () => {
  it('reports progress toward the next level', () => {
    const p = xpProgress(750);
    expect(p.level).toBe(2);
    expect(p.current).toBe(250);
    expect(p.needed).toBe(500);
    expect(p.percent).toBe(50);
  });

  it('is 0% at the start of a level', () => {
    expect(xpProgress(500).percent).toBe(0);
  });

  it('is near full just before leveling up', () => {
    const p = xpProgress(499);
    expect(p.level).toBe(1);
    expect(p.percent).toBeGreaterThanOrEqual(99);
  });
});
