import { Connection, isTransactionOrigin } from '@hocuspocus/server';
import type { PoolClient } from 'pg';
import { CollabProtocolDeniedError } from './collabErrors';
import { getYjsWriteUpdate } from './collaborationProtocol';
import {
  getConnectionLifecycle,
  removePendingWriteAdmission,
  type WriteAdmission,
  type WriteAdmissionContext,
} from './connectionLifecycle';
import type { PageTitleRuntime } from './pageTitleRuntime';
import { createWriteApplicationRuntime } from './writeApplicationRuntime';

type WriteAdmissionRuntimeOptions = {
  timeoutMs: number;
  titles: PageTitleRuntime;
  isRestMutationActive(documentName: string): boolean;
  blockDocument(documentName: string, code: number, reason: string): void;
};

type AppliedFenceState = {
  previousReadOnly: boolean;
  update?: Uint8Array;
  stop(): void;
};

type ApplicationFence = {
  admission: WriteAdmission;
  connection: Connection;
  context: WriteAdmissionContext;
  applicationStarted: boolean;
  complete(applied: boolean, changed?: boolean): Promise<void>;
};

export function createWriteAdmissionRuntime({
  timeoutMs,
  titles,
  isRestMutationActive,
  blockDocument,
}: WriteAdmissionRuntimeOptions) {
  const activeFences = new Set<ApplicationFence>();
  const applications = createWriteApplicationRuntime();
  const applicationFencesByMessage = new WeakMap<Uint8Array, ApplicationFence>();
  const expiredApplicationMessages = new WeakSet<Uint8Array>();
  const writeAdmissionsByUpdate = new WeakMap<Uint8Array, WriteAdmission>();

  function record(
    context: WriteAdmissionContext,
    accessRevision: string,
    titleRevision: string | undefined,
    touchesTitle: boolean,
    hasWriteUpdate: boolean,
  ): WriteAdmission | undefined {
    if (!hasWriteUpdate || !titleRevision) return undefined;
    const pending = getConnectionLifecycle(context).pendingWriteAdmissions;
    if (pending.length >= 64) {
      throw new CollabProtocolDeniedError('Too many writes awaiting application');
    }
    const admission = { accessRevision, titleRevision, touchesTitle };
    pending.push(admission);
    return admission;
  }

  function retainThroughApplication(options: {
    admission: WriteAdmission;
    connection: unknown;
    context: WriteAdmissionContext;
    documentName: string;
    message: Uint8Array;
    client: PoolClient;
  }): boolean {
    const { admission, connection, context, documentName, message, client } = options;
    if (!(connection instanceof Connection)) return false;
    const previousTitleBaseline = titles.getPendingBaseline(documentName);
    if (admission.touchesTitle) titles.setPendingBaseline(documentName, admission.titleRevision);
    applications.begin(context);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const fence: ApplicationFence = {
      admission,
      connection,
      context,
      applicationStarted: false,
      async complete(applied, changed = applied) {
        if (settled) return;
        settled = true;
        if (!applied && !fence.applicationStarted) expiredApplicationMessages.add(message);
        if (timeout) clearTimeout(timeout);
        applicationFencesByMessage.delete(message);
        activeFences.delete(fence);
        removePendingWriteAdmission(context, admission);
        let committed = false;
        try {
          await client.query(applied ? 'COMMIT' : 'ROLLBACK');
          committed = applied;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          blockDocument(documentName, 4500, 'Write application commit failed');
          throw error;
        } finally {
          if (admission.touchesTitle && (!committed || !changed)) {
            titles.restorePendingBaseline(
              documentName,
              admission.titleRevision,
              previousTitleBaseline,
            );
          }
          client.release();
          applications.finish(context);
        }
      },
    };
    applicationFencesByMessage.set(message, fence);
    activeFences.add(fence);
    timeout = setTimeout(() => {
      void fence
        .complete(false, false)
        .catch(() => undefined)
        .finally(() => connection.close({ code: 4500, reason: 'Write application timed out' }));
    }, timeoutMs);
    timeout.unref();
    return true;
  }

  function startApplication(fence: ApplicationFence): AppliedFenceState {
    const { connection } = fence;
    const state: AppliedFenceState = {
      previousReadOnly: connection.readOnly,
      stop: () => undefined,
    };
    const captureAppliedUpdate = (update: Uint8Array, origin: unknown): void => {
      if (
        state.update ||
        !isTransactionOrigin(origin) ||
        origin.source !== 'connection' ||
        origin.connection !== connection
      ) {
        return;
      }
      state.update = update;
      writeAdmissionsByUpdate.set(update, fence.admission);
      removePendingWriteAdmission(fence.context, fence.admission);
    };
    connection.document.on('update', captureAppliedUpdate);
    state.stop = () => connection.document.off('update', captureAppliedUpdate);
    connection.readOnly = false;
    return state;
  }

  function applyAdmittedMessage(
    connection: Connection,
    state: AppliedFenceState,
    apply: () => void,
  ): void {
    try {
      apply();
    } finally {
      // The writable override is needed only for the synchronous physical
      // application. Restore it before awaiting database work so a newer
      // permission transition cannot be overwritten by stale state.
      connection.readOnly = state.previousReadOnly;
    }
  }

  function finishApplication(state: AppliedFenceState): void {
    state.stop();
    if (state.update) writeAdmissionsByUpdate.delete(state.update);
  }

  async function applyMessage(options: {
    connection: Connection;
    message: Uint8Array;
    apply(): void;
  }): Promise<void> {
    const { connection, message, apply } = options;
    if (expiredApplicationMessages.delete(message)) {
      throw new Error('Write application fence expired');
    }

    const fence = applicationFencesByMessage.get(message);
    if (fence) fence.applicationStarted = true;
    if (getYjsWriteUpdate(message) && isRestMutationActive(connection.document.name)) {
      try {
        await fence?.complete(false, false);
      } catch {
        connection.close({ code: 4500, reason: 'Write application rollback failed' });
      }
      connection.close({
        code: 4500,
        reason: 'Content changed by a REST request; reconnect to resync',
      });
      throw new Error('Live write rejected while a REST content mutation is in progress');
    }
    if (!fence) {
      apply();
      return;
    }

    const state = startApplication(fence);
    try {
      try {
        applyAdmittedMessage(connection, state, apply);
      } catch (error) {
        try {
          await fence.complete(false, false);
        } catch {
          connection.close({ code: 4500, reason: 'Write application rollback failed' });
        }
        throw error;
      }
      try {
        await fence.complete(true, state.update !== undefined);
      } catch {
        connection.close({ code: 4500, reason: 'Write application commit failed' });
      }
    } finally {
      finishApplication(state);
    }
  }

  function consumeAdmissionForUpdate(update: Uint8Array): WriteAdmission | undefined {
    const admission = writeAdmissionsByUpdate.get(update);
    if (admission) writeAdmissionsByUpdate.delete(update);
    return admission;
  }

  return {
    applyMessage,
    completeAll: () =>
      Promise.allSettled(Array.from(activeFences, (fence) => fence.complete(false, false))),
    consumeAdmissionForUpdate,
    record,
    retainThroughApplication,
  };
}
