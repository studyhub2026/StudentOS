import { describe, expect, it } from 'vitest';
import { LmsProvider } from '@prisma/client';
import { listPublicRegistry, listRegistry, getMeta } from './registry';

describe('LMS registry', () => {
  it('lists all seven providers', () => {
    const rows = listRegistry();
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(
      [
        LmsProvider.BLACKBOARD,
        LmsProvider.BRIGHTSPACE,
        LmsProvider.CANVAS,
        LmsProvider.GOOGLE_CLASSROOM,
        LmsProvider.MOODLE,
        LmsProvider.MS_TEAMS,
        LmsProvider.SAKAI,
      ].sort(),
    );
  });

  it('marks every provider LIVE', () => {
    for (const r of listRegistry()) {
      expect(r.status, `${r.id} should be LIVE`).toBe('LIVE');
    }
  });

  it('gives every provider a semver adapterVersion above 0.0.0', () => {
    for (const r of listRegistry()) {
      expect(r.adapterVersion).not.toBe('0.0.0');
      expect(r.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('exposes COURSES capability for every provider (sync requires it)', () => {
    for (const r of listRegistry()) {
      expect(r.capabilities).toContain('COURSES');
    }
  });

  it('reports a readyReason when credentials are missing (test env has none)', () => {
    const rows = listPublicRegistry();
    // Moodle uses per-user tokens, so it's always ready. Everything else in a
    // no-credentials test environment should have ready=false with a reason.
    const moodle = rows.find((r) => r.id === LmsProvider.MOODLE);
    expect(moodle?.ready).toBe(true);
    for (const r of rows.filter((r) => r.id !== LmsProvider.MOODLE)) {
      if (!r.ready) {
        expect(r.readyReason, `${r.id} should have a reason when not ready`).toBeTruthy();
      }
    }
  });

  it('getMeta returns the exact row for each provider slug', () => {
    for (const r of listRegistry()) {
      expect(getMeta(r.id).slug).toBe(r.slug);
    }
  });
});
