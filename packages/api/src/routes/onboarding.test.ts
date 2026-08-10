import { describe, expect, it } from 'vitest';
import { createTestApp, createTestSession, createTestUser } from '../test-utils';

describe('onboarding API', () => {
  it('requires an authenticated session', async () => {
    const app = await createTestApp();

    const response = await app.request('/api/onboarding');

    expect(response.status).toBe(401);
  });

  it('reports incomplete onboarding until the user completes it', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const initialStatus = await app.request('/api/onboarding', {
      headers: { Cookie: session.Cookie },
    });
    expect(initialStatus.status).toBe(200);
    expect(await initialStatus.json()).toEqual({ completed: false });

    const completeResponse = await app.request('/api/onboarding/complete', {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });
    expect(completeResponse.status).toBe(200);
    expect(await completeResponse.json()).toEqual({ completed: true });

    const completedStatus = await app.request('/api/onboarding', {
      headers: { Cookie: session.Cookie },
    });
    expect(completedStatus.status).toBe(200);
    expect(await completedStatus.json()).toEqual({ completed: true });
  });
});
