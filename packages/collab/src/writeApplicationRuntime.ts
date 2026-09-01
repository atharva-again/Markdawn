import { type DeferredAwarenessContext, getConnectionLifecycle } from './connectionLifecycle';

export function createWriteApplicationRuntime() {
  return {
    begin(context: DeferredAwarenessContext): void {
      const lifecycle = getConnectionLifecycle(context);
      if (lifecycle.application.state === 'idle') {
        let resolveCompletion: () => void = () => {};
        const completion = new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        });
        lifecycle.application = {
          state: 'running',
          inFlight: 1,
          completion,
          resolveCompletion,
          closeScheduled: false,
          pendingCloseEvent: null,
        };
        return;
      }
      lifecycle.application.inFlight++;
    },
    finish(context: DeferredAwarenessContext): void {
      const lifecycle = getConnectionLifecycle(context);
      const application = lifecycle.application;
      if (application.state === 'idle') return;
      const remaining = application.inFlight - 1;
      if (remaining > 0) {
        application.inFlight = remaining;
        return;
      }
      application.resolveCompletion();
      lifecycle.application = { state: 'idle' };
    },
  };
}
