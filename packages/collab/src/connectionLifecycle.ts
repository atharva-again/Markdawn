import { Connection } from '@hocuspocus/server';

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
        pendingCloseEvent: NonNullable<Parameters<Connection['close']>[0]> | null;
        closeScheduled: boolean;
      };
  permissionChecks: { tail: Promise<void> };
  awareness: {
    clientId?: number;
    sentRelayFingerprints: Set<string>;
  };
  pendingWriteAdmissions: WriteAdmission[];
};

export type DeferredAwarenessContext = {
  lifecycle?: ConnectionLifecycle;
};

export type WriteAdmissionContext = {
  lifecycle: ConnectionLifecycle;
};

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
