import type { Connection, HocuspocusLifecycleHooks } from '@hocuspocus/server';
import {
  type DeferredAwarenessContext,
  getConnectionLifecycle,
  rejectConnectionTraffic,
} from './connectionLifecycle';

type ApplyMessage = (options: {
  connection: Connection;
  message: Uint8Array;
  apply(): void;
}) => Promise<void>;

function transferAwarenessToDuplicateConnection(connection: Connection): void {
  const context = connection.context as DeferredAwarenessContext | undefined;
  const clientId = context ? getConnectionLifecycle(context).awareness.clientId : undefined;
  if (clientId === undefined) return;

  const successor = connection.document.getConnections().find((otherConnection) => {
    if (otherConnection === connection) return false;
    const otherContext = otherConnection.context as DeferredAwarenessContext | undefined;
    return (
      (otherContext
        ? getConnectionLifecycle(otherContext).awareness.clientId === clientId
        : false) || connection.document.getClients(otherConnection).has(clientId)
    );
  });

  // Document.removeConnection removes every awareness client attributed to
  // the closing connection. V4 attributes only newly added awareness clients,
  // so a duplicate that updated an existing client may not be in this index.
  // Transfer the index entry so the last duplicate still removes the state.
  if (!successor) return;
  connection.document.getClients(connection).delete(clientId);
  connection.document.getClients(successor).add(clientId);
}

export function createHocuspocusAdapter(options: {
  rememberOutboundAwarenessEntries(context: DeferredAwarenessContext, message: unknown): void;
  applyMessage: ApplyMessage;
}): {
  lifecycleHooks: HocuspocusLifecycleHooks;
  ignoreMessage(message: Uint8Array): void;
} {
  const ignoredMessages = new WeakSet<Uint8Array>();

  return {
    ignoreMessage(message) {
      ignoredMessages.add(message);
    },
    lifecycleHooks: {
      deferInitialAwareness(connection) {
        const context = connection.context as DeferredAwarenessContext | undefined;
        return context ? getConnectionLifecycle(context).traffic.deferInitialAwareness : false;
      },
      beforeSend(connection, message) {
        const context = connection.context as DeferredAwarenessContext | undefined;
        const lifecycle = context ? getConnectionLifecycle(context) : undefined;
        const gate = lifecycle?.traffic.gate;
        if (gate?.state === 'pending') return false;
        if (gate?.state === 'rejected' && connection.document.hasConnection(connection)) {
          return false;
        }
        if (context) options.rememberOutboundAwarenessEntries(context, message);
        return true;
      },
      beforeClose(connection, event, close) {
        const context = connection.context as DeferredAwarenessContext | undefined;
        const application = context ? getConnectionLifecycle(context).application : undefined;
        if (application?.state !== 'running') {
          transferAwarenessToDuplicateConnection(connection);
          if (context) {
            const gate = getConnectionLifecycle(context).traffic.gate;
            if (gate.state === 'pending') {
              // No traffic has been admitted yet. Reject immediately so the
              // close packet is the only outbound document message allowed.
              rejectConnectionTraffic(context);
            } else if (gate.state === 'established') {
              // A transport close can race frames already accepted by
              // Connection.handleMessage. Keep their established gate valid
              // until processing finishes so disconnect persistence observes
              // the final update, then fail closed for any later work.
              void connection
                .waitForPendingMessages()
                .finally(() => rejectConnectionTraffic(context));
            }
          }
          return false;
        }

        if (context) rejectConnectionTraffic(context);
        application.pendingCloseEvent = event ?? null;
        if (!application.closeScheduled) {
          application.closeScheduled = true;
          void application.completion.finally(() => {
            application.closeScheduled = false;
            const pendingEvent = application.pendingCloseEvent;
            application.pendingCloseEvent = null;
            transferAwarenessToDuplicateConnection(connection);
            close(pendingEvent ?? undefined);
          });
        }
        return true;
      },
      async aroundApplyMessage(connection, message, apply) {
        if (ignoredMessages.delete(message)) return;
        await options.applyMessage({ connection, message, apply });
      },
    },
  };
}
