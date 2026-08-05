import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_EXTENSIONS,
  SUPPORTED_UPLOAD_TYPES,
  isMedia,
  isImageOrPdf,
  resolveType,
} from './file-extract.service';

describe('file-extract type registry', () => {
  it('supports audio and video mimes', () => {
    expect(SUPPORTED_UPLOAD_TYPES['audio/mpeg']?.mode).toBe('transcribe');
    expect(SUPPORTED_UPLOAD_TYPES['audio/wav']?.kind).toBe('AUDIO');
    expect(SUPPORTED_UPLOAD_TYPES['video/mp4']?.mode).toBe('transcribe');
    expect(SUPPORTED_UPLOAD_TYPES['video/webm']?.kind).toBe('VIDEO');
  });

  it('accepts media extensions in the file picker', () => {
    for (const ext of ['.mp3', '.m4a', '.wav', '.mp4', '.webm', '.mov']) {
      expect(ACCEPTED_EXTENSIONS).toContain(ext);
    }
  });

  it('resolves audio by extension when the browser omits the mime', () => {
    const spec = resolveType('application/octet-stream', 'lecture.mp3');
    expect(spec.mode).toBe('transcribe');
    expect(spec.kind).toBe('AUDIO');
  });

  it('resolves video by extension', () => {
    const spec = resolveType('application/octet-stream', 'seminar.mp4');
    expect(spec.kind).toBe('VIDEO');
  });

  it('normalises image/jpg to image/jpeg', () => {
    const spec = resolveType('image/jpg', 'photo.jpg');
    expect(spec.ext).toBe('jpg');
    expect(spec.kind).toBe('IMAGE');
  });

  it('rejects unknown types with a helpful message', () => {
    expect(() => resolveType('application/x-msdownload', 'virus.exe')).toThrow(
      /supported/i,
    );
  });

  describe('isImageOrPdf / isMedia predicates', () => {
    it('classifies pdf as gemini-native', () => {
      expect(isImageOrPdf('application/pdf', 'a.pdf')).toBe(true);
      expect(isMedia('application/pdf', 'a.pdf')).toBe(false);
    });

    it('classifies audio as media-not-gemini', () => {
      expect(isImageOrPdf('audio/mpeg', 'a.mp3')).toBe(false);
      expect(isMedia('audio/mpeg', 'a.mp3')).toBe(true);
    });

    it('classifies video as media', () => {
      expect(isMedia('video/mp4', 'a.mp4')).toBe(true);
    });

    it('classifies plain text as neither', () => {
      expect(isImageOrPdf('text/plain', 'a.txt')).toBe(false);
      expect(isMedia('text/plain', 'a.txt')).toBe(false);
    });
  });
});
