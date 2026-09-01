import { describe, expect, it } from 'vitest';
import { rememberOutboundAwarenessEntries } from './awarenessPolicy';
import { encodeAwarenessMessage } from './collabTestUtils';
import type { DeferredAwarenessContext } from './connectionLifecycle';

describe('awareness relay memory', () => {
  it('records canonical awareness entries and keeps a bounded history', () => {
    const context: DeferredAwarenessContext = {};
    for (let clientId = 1; clientId <= 300; clientId += 1) {
      rememberOutboundAwarenessEntries(
        context,
        encodeAwarenessMessage('page-id', [{ clientId, clock: 1, state: { clientId } }]),
      );
    }

    const fingerprints = context.lifecycle?.awareness.sentRelayFingerprints;
    expect(fingerprints?.size).toBe(256);
    expect(fingerprints?.has(JSON.stringify([300, 1, { clientId: 300 }]))).toBe(true);
    expect(fingerprints?.has(JSON.stringify([1, 1, { clientId: 1 }]))).toBe(false);
  });

  it('ignores non-awareness payloads', () => {
    const context: DeferredAwarenessContext = {};
    rememberOutboundAwarenessEntries(context, new Uint8Array([255]));
    expect(context.lifecycle).toBeUndefined();
  });
});
