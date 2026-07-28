import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJsonRequest } from './requestValidation';

describe('parseJsonRequest', () => {
  it('rejects malformed UTF-8 before parsing JSON', async () => {
    const app = new Hono();
    app.post('/', async (context) => {
      const body = await parseJsonRequest(context, z.object({ value: z.string() }));
      return context.json(body);
    });

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new Uint8Array([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    });

    expect(response.status).toBe(400);
  });
});
