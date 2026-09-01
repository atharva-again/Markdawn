import { describe, expect, it } from 'vitest';
import type { DeferredAwarenessContext } from './connectionLifecycle';
import { createWriteApplicationRuntime } from './writeApplicationRuntime';

describe('write application runtime', () => {
  it('tracks overlapping applications with one completion barrier', async () => {
    const runtime = createWriteApplicationRuntime();
    const context: DeferredAwarenessContext = {};
    runtime.begin(context);
    runtime.begin(context);
    const application = context.lifecycle?.application;
    const barrier = application?.state === 'running' ? application.completion : undefined;
    expect(barrier).toBeDefined();
    runtime.finish(context);
    expect(context.lifecycle?.application.state).toBe('running');
    if (context.lifecycle?.application.state === 'running') {
      expect(context.lifecycle.application.completion).toBe(barrier);
    }
    runtime.finish(context);
    await expect(barrier).resolves.toBeUndefined();
    expect(context.lifecycle?.application.state).toBe('idle');
  });
});
