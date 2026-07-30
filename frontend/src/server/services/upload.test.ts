import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildPublicId, buildSignature, validateUploadResult } from './upload.service';

describe('cloudinary signature', () => {
  const SECRET = 'test-api-secret';

  it('matches Cloudinary’s documented algorithm', () => {
    // Reference: params sorted by key, joined k=v with &, secret appended,
    // SHA-1 hex. Computed independently here rather than trusting our own code.
    const params = { public_id: 'sample_image', timestamp: 1315060510 };
    const expected = crypto
      .createHash('sha1')
      .update(`public_id=sample_image&timestamp=1315060510${SECRET}`)
      .digest('hex');

    expect(buildSignature(params, SECRET)).toBe(expected);
  });

  it('sorts parameters regardless of insertion order', () => {
    const a = buildSignature({ timestamp: 123, public_id: 'x' }, SECRET);
    const b = buildSignature({ public_id: 'x', timestamp: 123 }, SECRET);
    expect(a).toBe(b);
  });

  it('produces a different signature for a different public id', () => {
    expect(buildSignature({ public_id: 'a', timestamp: 1 }, SECRET)).not.toBe(
      buildSignature({ public_id: 'b', timestamp: 1 }, SECRET),
    );
  });

  it('produces a different signature for a different timestamp', () => {
    expect(buildSignature({ public_id: 'a', timestamp: 1 }, SECRET)).not.toBe(
      buildSignature({ public_id: 'a', timestamp: 2 }, SECRET),
    );
  });

  it('produces a different signature under a different secret', () => {
    const params = { public_id: 'a', timestamp: 1 };
    expect(buildSignature(params, SECRET)).not.toBe(buildSignature(params, 'other-secret'));
  });

  it('returns a 40-character hex digest', () => {
    expect(buildSignature({ public_id: 'a', timestamp: 1 }, SECRET)).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe('public id derivation', () => {
  it('scopes the id to the owner', () => {
    expect(buildPublicId('avatars', 'user_123')).toMatch(
      /^studentos\/avatars\/user_123\/\d+-[a-f0-9]{16}$/,
    );
  });

  it('never collides across calls', () => {
    const ids = new Set(
      Array.from({ length: 500 }, () => buildPublicId('notes', 'user_1')),
    );
    expect(ids.size).toBe(500);
  });

  it('separates users into distinct prefixes', () => {
    expect(buildPublicId('notes', 'a').startsWith('studentos/notes/a/')).toBe(true);
    expect(buildPublicId('notes', 'b').startsWith('studentos/notes/b/')).toBe(true);
  });
});

describe('upload result validation', () => {
  const USER = 'user_1';
  // Matches the CLOUDINARY_CLOUD_NAME in the test environment (unset → '').
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
  const validUrl = `https://res.cloudinary.com/${cloudName}/image/upload/v1/studentos/notes/${USER}/x.png`;

  function result(overrides: Partial<Parameters<typeof validateUploadResult>[2]> = {}) {
    return {
      publicId: `studentos/notes/${USER}/123-abc`,
      url: validUrl,
      bytes: 1024,
      format: 'png',
      ...overrides,
    };
  }

  it('accepts a well-formed upload', () => {
    expect(() => validateUploadResult(USER, 'notes', result())).not.toThrow();
  });

  it('rejects a public id belonging to another user', () => {
    expect(() =>
      validateUploadResult(USER, 'notes', result({ publicId: 'studentos/notes/someone_else/1' })),
    ).toThrow(/does not belong to you/i);
  });

  it('rejects a public id from a different folder', () => {
    expect(() =>
      validateUploadResult(USER, 'notes', result({ publicId: `studentos/avatars/${USER}/1` })),
    ).toThrow(/does not belong to you/i);
  });

  it('rejects a file over the folder limit', () => {
    // Avatars cap at 2MB.
    expect(() =>
      validateUploadResult(USER, 'avatars', {
        publicId: `studentos/avatars/${USER}/1`,
        url: `https://res.cloudinary.com/${cloudName}/image/upload/a.png`,
        bytes: 5 * 1024 * 1024,
        format: 'png',
      }),
    ).toThrow(/too large/i);
  });

  it('rejects a disallowed format', () => {
    expect(() => validateUploadResult(USER, 'avatars', {
      publicId: `studentos/avatars/${USER}/1`,
      url: `https://res.cloudinary.com/${cloudName}/image/upload/a.exe`,
      bytes: 1024,
      format: 'exe',
    })).toThrow(/not allowed/i);
  });

  it('rejects a URL pointing at a different host', () => {
    expect(() =>
      validateUploadResult(USER, 'notes', result({ url: 'https://evil.example.com/x.png' })),
    ).toThrow(/not from the configured/i);
  });

  it('rejects a URL on a different Cloudinary account', () => {
    expect(() =>
      validateUploadResult(
        USER,
        'notes',
        result({ url: 'https://res.cloudinary.com/some-other-cloud/image/upload/x.png' }),
      ),
    ).toThrow(/not from the configured/i);
  });

  it('accepts an upload with no reported format', () => {
    expect(() =>
      validateUploadResult(USER, 'notes', { ...result(), format: undefined }),
    ).not.toThrow();
  });

  it('allows documents in assignment attachments but not avatars', () => {
    const pdf = {
      publicId: `studentos/assignments/${USER}/1`,
      url: `https://res.cloudinary.com/${cloudName}/raw/upload/x.pdf`,
      bytes: 1024,
      format: 'pdf',
    };
    expect(() => validateUploadResult(USER, 'assignments', pdf)).not.toThrow();

    expect(() =>
      validateUploadResult(USER, 'avatars', {
        ...pdf,
        publicId: `studentos/avatars/${USER}/1`,
      }),
    ).toThrow(/not allowed/i);
  });
});
