import { Connection, type Document, type HocuspocusLifecycleHooks } from '@hocuspocus/server';
import { getYjsWriteUpdate } from './collaborationProtocol';

export type WriteAdmission = {
  accessRevision: string;
  titleRevision: string;
  touchesTitle: boolean;
};

export type EstablishmentGate = {
  state: 'pending' | 'established' | 'rejected';
  ready: Promise<boolean>;
  settle(allowed: boolean): void;
};

export type ConnectionLifecycle = {
  traffic: {
    gate: EstablishmentGate;
    deferInitialAwareness: boolean;
  };
  application:
    | { state: 'idle' }
    | {
        state: 'running';
        inFlight: number;
        completion: Promise<void>;
        resolveCompletion: () => void;
        pendingCloseEvent?: NonNullable<Parameters<Connection['close']>[0]>;
        closeScheduled: boolean;
      };
  permissionChecks: { tail: Promise<void> };
  awareness: { clientId?: number; sentRelayFingerprints: Set<string> };
  pendingWriteAdmissions: WriteAdmission[];
};

export type DeferredAwarenessContext = {
  lifecycle?: ConnectionLifecycle;
};

export type WriteAdmissionContext = {
  lifecycle: ConnectionLifecycle;
};

export type ApplicationFence = {
  admission: WriteAdmission;
  context: WriteAdmissionContext;
  complete(applied: boolean, changed?: boolean): Promise<void>;
};

export const applicationFencesByMessage = new WeakMap<Uint8Array, ApplicationFence>();
export const expiredApplicationMessages = new WeakSet<Uint8Array>();
export const relayedAwarenessMessages = new WeakSet<Uint8Array>();
export const writeAdmissionsByUpdate = new WeakMap<Uint8Array, WriteAdmission>();

export function createConnectionLifecycle(): ConnectionLifecycle {
  return {
    traffic: { gate: createEstablishmentGate(), deferInitialAwareness: true },
    application: { state: 'idle' },
    permissionChecks: { tail: Promise.resolve() },
    awareness: { sentRelayFingerprints: new Set() },
    pendingWriteAdmissions: [],
  };
}

export function getConnectionLifecycle(context: DeferredAwarenessContext): ConnectionLifecycle {
  context.lifecycle ??= createConnectionLifecycle();
  return context.lifecycle;
}

export function removePendingWriteAdmission(
  context: WriteAdmissionContext,
  admission: WriteAdmission,
): void {
  const pending = getConnectionLifecycle(context).pendingWriteAdmissions;
  const index = pending.indexOf(admission);
  if (index >= 0) pending.splice(index, 1);
}

export function createEstablishmentGate(): EstablishmentGate {
  let resolveReady: ((allowed: boolean) => void) | undefined;
  const gate: EstablishmentGate = {
    state: 'pending',
    ready: new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    }),
    settle(allowed) {
      if (gate.state !== 'pending') return;
      gate.state = allowed ? 'established' : 'rejected';
      resolveReady?.(allowed);
    },
  };
  return gate;
}

export function releaseConnectionTraffic(context: DeferredAwarenessContext): boolean {
  const gate = getConnectionLifecycle(context).traffic.gate;
  if (gate.state === 'rejected') return false;
  gate.settle(true);
  return true;
}

export function rejectConnectionTraffic(context: DeferredAwarenessContext): void {
  const lifecycle = getConnectionLifecycle(context);
  const gate = lifecycle.traffic.gate;
  if (gate.state === 'pending') gate.settle(false);
  else gate.state = 'rejected';
  lifecycle.traffic.deferInitialAwareness = false;
}

export async function waitForConnectionTraffic(
  context: DeferredAwarenessContext,
  connection: unknown,
): Promise<boolean> {
  const gate = getConnectionLifecycle(context).traffic.gate;
  if (gate.state === 'rejected') return false;
  if (!(connection instanceof Connection)) return true;
  const allowed = await gate.ready;
  return allowed && gate.state === 'established';
}

export function sendDeferredInitialAwareness(connection: Connection): void {
  const context = connection.context as DeferredAwarenessContext | undefined;
  if (!context) return;
  const traffic = getConnectionLifecycle(context).traffic;
  if (!traffic.deferInitialAwareness) return;
  traffic.deferInitialAwareness = false;
  connection.sendCurrentAwareness();
}

/**
 * Build the server-scoped lifecycle hooks supplied by Markdawn's pinned
 * @hocuspocus/server package patch.
 */
export function createHocuspocusV3LifecycleHooks(options: {
  rememberOutboundAwarenessEntries(context: DeferredAwarenessContext, message: unknown): void;
  isRestMutationActive(documentName: string): boolean;
}): HocuspocusLifecycleHooks {
  return {
    deferInitialAwareness(connection) {
      const context = connection.context as DeferredAwarenessContext | undefined;
      return context ? getConnectionLifecycle(context).traffic.deferInitialAwareness : false;
    },
    beforeSend(connection, message) {
      const context = connection.context as DeferredAwarenessContext | undefined;
      const lifecycle = context ? getConnectionLifecycle(context) : undefined;
      const gate = lifecycle?.traffic.gate;
      // The gate owns authorization. Awareness deferral only suppresses
      // Hocuspocus's automatic initial awareness message; it must not also
      // suppress the verified initial permission snapshot.
      if (gate?.state === 'pending') return false;
      if (gate?.state === 'rejected' && connection.document.hasConnection(connection)) return false;
      if (context) options.rememberOutboundAwarenessEntries(context, message);
      return true;
    },
    beforeClose(connection, event, close) {
      const context = connection.context as DeferredAwarenessContext | undefined;
      if (context) rejectConnectionTraffic(context);
      const application = context ? getConnectionLifecycle(context).application : undefined;
      if (application?.state === 'running') {
        if (event === undefined) delete application.pendingCloseEvent;
        else application.pendingCloseEvent = event;
        if (!application.closeScheduled) {
          application.closeScheduled = true;
          void application.completion.finally(() => {
            application.closeScheduled = false;
            const pendingEvent = application.pendingCloseEvent;
            delete application.pendingCloseEvent;
            // The dependency-owned close callback has already captured the
            // original event. Preserve the latest event selected above by
            // updating it through a normal close only when it differs.
            if (pendingEvent === event) close();
            else connection.close(pendingEvent);
          });
        }
        return true;
      }
      return false;
    },
    applyMessage(receiver, document: Document, connection, _reply, apply) {
      const rawMessage = receiver.message.decoder.arr;
      if (relayedAwarenessMessages.has(rawMessage)) {
        relayedAwarenessMessages.delete(rawMessage);
        return;
      }
      if (expiredApplicationMessages.has(rawMessage)) {
        expiredApplicationMessages.delete(rawMessage);
        throw new Error('Write application fence expired');
      }
      const fence = applicationFencesByMessage.get(rawMessage);
      if (getYjsWriteUpdate(rawMessage) && options.isRestMutationActive(document.name)) {
        // Hocuspocus applies messages synchronously, while a REST command can
        // hold the document across asynchronous persistence. Do not merge a
        // live write into that guarded REST mutation: roll back its admission
        // and force the client to resync from the committed document.
        void fence?.complete(false).catch(() => {
          connection?.close({ code: 4500, reason: 'Write application rollback failed' });
        });
        connection?.close({
          code: 4500,
          reason: 'Content changed by a REST request; reconnect to resync',
        });
        throw new Error('Live write rejected while a REST content mutation is in progress');
      }
      if (!fence) {
        apply();
        return;
      }

      let capturedUpdate: Uint8Array | undefined;
      const captureAppliedUpdate = (innerUpdate: Uint8Array, origin: unknown) => {
        if (capturedUpdate || origin !== connection) return;
        capturedUpdate = innerUpdate;
        writeAdmissionsByUpdate.set(innerUpdate, fence.admission);
        removePendingWriteAdmission(fence.context, fence.admission);
      };
      document.on('update', captureAppliedUpdate);
      const currentReadOnly = connection?.readOnly;
      // The fence proves this exact update was admitted while the connection was
      // writable. A later downgrade may flip `readOnly` before Hocuspocus
      // physically applies the message; preserve the admission instead of
      // re-evaluating mutable connection state here.
      if (connection) connection.readOnly = false;
      try {
        apply();
        if (!capturedUpdate) removePendingWriteAdmission(fence.context, fence.admission);
        void fence.complete(true, capturedUpdate !== undefined).catch(() => {
          connection?.close({ code: 4500, reason: 'Write application commit failed' });
        });
      } catch (error) {
        if (capturedUpdate) writeAdmissionsByUpdate.delete(capturedUpdate);
        removePendingWriteAdmission(fence.context, fence.admission);
        void fence.complete(false).catch(() => {
          connection?.close({ code: 4500, reason: 'Write application rollback failed' });
        });
        throw error;
      } finally {
        if (connection && currentReadOnly !== undefined) connection.readOnly = currentReadOnly;
        document.off('update', captureAppliedUpdate);
      }
    },
  };
}
