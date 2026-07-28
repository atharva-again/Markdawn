import { describe, expect, it } from 'vitest';
import { MAX_INTERNAL_CONTENT_COMMAND_BYTES } from '../types/internalContentCommand';
import {
  COLLAB_TERMINAL_REASONS,
  DEFAULT_MAX_COLLAB_PAYLOAD_BYTES,
  MAX_YDOC_BYTES,
} from './collaboration';

describe('collaboration size limits', () => {
  it('allows a complete supported Yjs document plus protocol framing', () => {
    expect(DEFAULT_MAX_COLLAB_PAYLOAD_BYTES).toBeGreaterThan(MAX_YDOC_BYTES);
    expect(DEFAULT_MAX_COLLAB_PAYLOAD_BYTES - MAX_YDOC_BYTES).toBeGreaterThanOrEqual(64 * 1024);
  });

  it('allows two document-sized exact-edit fields plus command framing', () => {
    expect(MAX_INTERNAL_CONTENT_COMMAND_BYTES).toBeGreaterThan(MAX_YDOC_BYTES * 2);
  });
});

describe('collaboration close contract', () => {
  it('keeps terminal per-document close reasons stable for browser eviction', () => {
    expect(COLLAB_TERMINAL_REASONS).toEqual({
      ACCESS_REVOKED: 'Access revoked',
      PAGE_DELETED: 'Page deleted',
      PERMISSION_VERIFICATION_FAILED: 'Permission verification failed',
      SESSION_EXPIRED: 'Session expired',
    });
  });
});
