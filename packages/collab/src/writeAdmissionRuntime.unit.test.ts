import { Connection, Document, type Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createConnectionLifecycle, type WriteAdmissionContext } from './connectionLifecycle';
import { createDocumentWriteCoordinator } from './documentWriteCoordinator';
import { createPageTitleRuntime } from './pageTitleRuntime';
import { createWriteAdmissionRuntime } from './writeAdmissionRuntime';

function createRuntime() {
  const hocuspocus = { documents: new Map() } as unknown as Hocuspocus;
  const coordinator = createDocumentWriteCoordinator({
    pool: {} as Pool,
    logger: { warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    maxDocumentBytes: 100,
    getHocuspocus: () => hocuspocus,
    access: {
      assertAnonymousPageAccess: vi.fn(),
      assertPageAccess: vi.fn(),
      lockDocumentAccessMutation: vi.fn(),
    },
  });
  const titles = createPageTitleRuntime({
    pool: {} as Pool,
    logger: { warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    getHocuspocus: () => hocuspocus,
    blockDocument: coordinator.blockDocumentForReload,
  });
  return createWriteAdmissionRuntime({
    timeoutMs: 100,
    titles,
    isRestMutationActive: () => false,
    blockDocument: coordinator.blockDocumentForReload,
  });
}

function createConnection(context: WriteAdmissionContext, documentName = 'page-1') {
  const document = new Document(documentName);
  const socket = {
    binaryType: 'nodebuffer',
    readyState: 1,
    send: vi.fn(),
  };
  const connection = new Connection(
    socket as never,
    new Request('http://localhost'),
    document,
    crypto.randomUUID(),
    context,
  );
  return { connection, document };
}

describe('write admission runtime', () => {
  it('records an immutable admission for a writable update', () => {
    const runtime = createRuntime();
    const context: WriteAdmissionContext = { lifecycle: createConnectionLifecycle() };
    const admission = runtime.record(context, '7', '3', true, true);
    expect(admission).toEqual({ accessRevision: '7', titleRevision: '3', touchesTitle: true });
    expect(context.lifecycle.pendingWriteAdmissions).toEqual([admission]);
  });

  it('rejects a queued application after the admission is rolled back during shutdown', async () => {
    const runtime = createRuntime();
    const context: WriteAdmissionContext = { lifecycle: createConnectionLifecycle() };
    const admission = runtime.record(context, '7', '3', false, true);
    if (!admission) throw new Error('Expected a write admission');

    const { connection, document } = createConnection(context);
    const client = {
      query: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    } as unknown as PoolClient;
    const message = Uint8Array.of(1, 2, 3);
    try {
      expect(
        runtime.retainThroughApplication({
          admission,
          connection,
          context,
          documentName: document.name,
          message,
          client,
        }),
      ).toBe(true);

      await runtime.completeAll();

      await expect(runtime.applyMessage({ connection, message, apply: vi.fn() })).rejects.toThrow(
        'Write application fence expired',
      );
    } finally {
      connection.close();
      document.destroy();
    }
  });

  it('preserves a permission downgrade while the admitted write commits', async () => {
    const runtime = createRuntime();
    const context: WriteAdmissionContext = { lifecycle: createConnectionLifecycle() };
    const admission = runtime.record(context, '7', '3', false, true);
    if (!admission) throw new Error('Expected a write admission');

    const { connection, document } = createConnection(context);
    let resolveCommit: (() => void) | undefined;
    const commit = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const client = {
      query: vi.fn((statement: string) =>
        statement === 'COMMIT' ? commit : Promise.resolve(undefined),
      ),
      release: vi.fn(),
    } as unknown as PoolClient;
    const message = Uint8Array.of(1, 2, 3);

    try {
      expect(
        runtime.retainThroughApplication({
          admission,
          connection,
          context,
          documentName: document.name,
          message,
          client,
        }),
      ).toBe(true);

      const apply = vi.fn(() => expect(connection.readOnly).toBe(false));
      const application = runtime.applyMessage({ connection, message, apply });
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(apply).toHaveBeenCalledOnce();

      connection.readOnly = true;
      resolveCommit?.();
      await application;

      expect(connection.readOnly).toBe(true);
    } finally {
      resolveCommit?.();
      connection.close();
      document.destroy();
    }
  });
});
