import { describe, expect, it } from 'vitest';
import { createContentCommandAdmission } from './contentCommandAdmission';

describe('content command admission', () => {
  it('bounds global and per-document work and releases capacity', () => {
    const admission = createContentCommandAdmission({ maxConcurrent: 2, maxPerDocument: 1 });
    const releaseA = admission.tryAcquire('page-a');
    const releaseB = admission.tryAcquire('page-b');
    expect(releaseA).toEqual(expect.any(Function));
    expect(releaseB).toEqual(expect.any(Function));
    expect(admission.tryAcquire('page-a')).toBeNull();
    expect(admission.tryAcquire('page-c')).toBeNull();

    releaseA?.();
    const releaseC = admission.tryAcquire('page-c');
    expect(releaseC).toEqual(expect.any(Function));
    releaseB?.();
    releaseC?.();
  });
});
