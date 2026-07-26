import { Connection, Document } from '@hocuspocus/server';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createConnectionLifecycle,
  createHocuspocusV3LifecycleHooks,
  rejectConnectionTraffic,
  releaseConnectionTraffic,
  removePendingWriteAdmission,
  type WriteAdmission,
} from './hocuspocusV3Adapter';
import { encodeYjsUpdateMessage } from './serverTestHarness';

describe('Hocuspocus v3 adapter state', () => {
  it('settles establishment exactly once and remains fail closed after rejection', async () => {
    const context = { lifecycle: createConnectionLifecycle() };
    rejectConnectionTraffic(context);
    expect(await context.lifecycle.traffic.gate.ready).toBe(false);
    expect(releaseConnectionTraffic(context)).toBe(false);
    expect(context.lifecycle.traffic.gate.state).toBe('rejected');
  });

  it('allows a verified permission snapshot before deferred initial awareness', () => {
    const lifecycle = createConnectionLifecycle();
    const context = { lifecycle };
    const hooks = createHocuspocusV3LifecycleHooks({
      rememberOutboundAwarenessEntries: vi.fn(),
      isRestMutationActive: () => false,
    });

    releaseConnectionTraffic(context);

    expect(lifecycle.traffic.deferInitialAwareness).toBe(true);
    expect(hooks.beforeSend?.({ context } as Connection, new Uint8Array([0]))).toBe(true);
  });

  it('removes completed write admissions without retaining an empty queue', () => {
    const admission: WriteAdmission = {
      accessRevision: '1',
      titleRevision: '2',
      touchesTitle: false,
    };
    const lifecycle = createConnectionLifecycle();
    lifecycle.pendingWriteAdmissions.push(admission);
    const context = { lifecycle };
    removePendingWriteAdmission(context, admission);
    expect(context.lifecycle.pendingWriteAdmissions).toEqual([]);
  });

  it('rejects a live write while a REST mutation owns the document', () => {
    const documentName = crypto.randomUUID();
    const source = new Y.Doc();
    source.getText('content').insert(0, 'live update');
    const message = encodeYjsUpdateMessage(documentName, Y.encodeStateAsUpdate(source));
    const close = vi.fn();
    const apply = vi.fn();
    const hooks = createHocuspocusV3LifecycleHooks({
      rememberOutboundAwarenessEntries: vi.fn(),
      isRestMutationActive: (name) => name === documentName,
    });

    expect(() =>
      hooks.applyMessage?.(
        { message: { decoder: { arr: message } } } as never,
        new Document(documentName),
        { close } as never,
        undefined,
        apply,
      ),
    ).toThrow('Live write rejected while a REST content mutation is in progress');
    expect(apply).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith({
      code: 4500,
      reason: 'Content changed by a REST request; reconnect to resync',
    });
    source.destroy();
  });

  it('keeps lifecycle hooks scoped to each connection', () => {
    const firstRemember = vi.fn();
    const secondRemember = vi.fn();
    const createConnection = (remember: (context: object, message: unknown) => void) => {
      const lifecycle = createConnectionLifecycle();
      lifecycle.traffic.gate.settle(true);
      lifecycle.traffic.deferInitialAwareness = false;
      const socket = {
        binaryType: 'nodebuffer',
        readyState: 1,
        send: vi.fn((_message: unknown, callback?: (error?: Error) => void) => callback?.()),
      };
      return new Connection(
        socket as never,
        { headers: {} } as never,
        new Document(crypto.randomUUID()),
        crypto.randomUUID(),
        { lifecycle },
        false,
        createHocuspocusV3LifecycleHooks({
          rememberOutboundAwarenessEntries: remember,
          isRestMutationActive: () => false,
        }),
      );
    };
    const firstConnection = createConnection(firstRemember);
    const secondConnection = createConnection(secondRemember);

    firstConnection.send(new Uint8Array([1]));

    expect(firstRemember).toHaveBeenCalledTimes(1);
    expect(secondRemember).not.toHaveBeenCalled();
    firstConnection.close();
    secondConnection.close();
  });
});
