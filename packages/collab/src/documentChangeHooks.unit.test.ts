import type { onDisconnectPayload } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createDocumentChangeHooks } from './documentChangeHooks';
import type { PageTitleRuntime } from './pageTitleRuntime';

describe('document change disconnect hooks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports terminal disconnect persistence failure without rejecting the callback', async () => {
    vi.useFakeTimers();
    const documentName = crypto.randomUUID();
    const document = new Y.Doc();
    const logger = { error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const flushDocument = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const hooks = createDocumentChangeHooks({
      logger,
      maxDocumentBytes: 1024,
      titles: { clear: vi.fn() } as unknown as PageTitleRuntime,
      isMetaRoom: () => false,
      isDocumentBlocked: () => false,
      getActiveDocument: () => document,
      getDocumentSizeEstimate: () => 0,
      setDocumentSizeEstimate: vi.fn(),
      blockOversizedDocument: vi.fn(),
      recordDocumentChange: vi.fn(),
      consumeAdmissionForUpdate: vi.fn(),
      resetDocumentState: vi.fn(),
      flushDocument,
    });
    const persistence = hooks.onDisconnect({
      documentName,
      instance: { documents: new Map([[documentName, document]]) },
      context: undefined,
    } as unknown as onDisconnectPayload);

    await vi.runAllTimersAsync();

    await expect(persistence).resolves.toBeUndefined();
    expect(flushDocument).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenLastCalledWith(
      expect.stringContaining(`after 3 attempts: Error: database unavailable`),
    );
    document.destroy();
  });
});
