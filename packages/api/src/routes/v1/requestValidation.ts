import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

export async function readUtf8Request(context: Context): Promise<string> {
  const bytes = await context.req.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    // UTF-8 decoding is an HTTP boundary: malformed client bytes are a 400,
    // while stream/body-limit failures above continue to their owning handler.
    throw new HTTPException(400, { message: 'Invalid UTF-8 body', cause: error });
  }
}

export async function parseJsonRequest<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = JSON.parse(await readUtf8Request(context));
  } catch (error) {
    // The body-limit middleware translates its streaming sentinel to 413
    // after downstream unwinds, so it must pass through unchanged.
    if (error instanceof Error && error.name === 'BodyLimitError') throw error;
    if (error instanceof HTTPException) throw error;
    // JSON parsing is an HTTP boundary. Malformed JSON is a client error;
    // preserve the parser failure as context rather than substituting a value.
    throw new HTTPException(400, { message: 'Invalid JSON body', cause: error });
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new HTTPException(400, {
    message: parsed.error.issues[0]?.message ?? 'Invalid body',
  });
}

export async function parseMultipartRequest<T>(context: Context, schema: z.ZodType<T>): Promise<T> {
  let formData: FormData;
  try {
    formData = await context.req.formData();
  } catch (error) {
    // Multipart decoding is an HTTP boundary. Invalid multipart framing is a
    // client error, while transport and body-limit failures remain visible to
    // their owning middleware.
    if (error instanceof Error && error.name === 'BodyLimitError') throw error;
    throw new HTTPException(400, { message: 'Invalid multipart body', cause: error });
  }
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));
  if (parsed.success) return parsed.data;
  throw new HTTPException(400, {
    message: parsed.error.issues[0]?.message ?? 'Invalid multipart body',
  });
}
