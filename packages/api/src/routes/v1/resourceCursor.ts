import { HTTPException } from 'hono/http-exception';
import { requireUuid } from './pageModel';

export type ResourceCursor = { updatedAt: string; id: string };
export type ResourceCursorRow = { id: string; cursor_updated_at: string };

export function parseResourceLimit(value: string | undefined): number {
  const limit = Number(value ?? '50');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HTTPException(400, { message: 'limit must be between 1 and 100' });
  }
  return limit;
}

export function encodeResourceCursor(row: ResourceCursorRow): string {
  return Buffer.from(JSON.stringify([row.cursor_updated_at, row.id])).toString('base64url');
}

function isValidCursorTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})$/);
  if (!match) return false;
  const millisecondTimestamp = `${value.slice(0, 19)}.${value.slice(20, 23)}Z`;
  const parsed = new Date(millisecondTimestamp);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

export function decodeResourceCursor(value: string | undefined): ResourceCursor | null {
  if (!value) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid cursor encoding');
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error('Non-canonical cursor encoding');
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('Invalid cursor');
    const [dateValue, id] = parsed;
    if (!isValidCursorTimestamp(dateValue) || typeof id !== 'string') throw new Error();
    requireUuid(id, 'cursor ID');
    return { updatedAt: dateValue, id };
  } catch {
    // Cursors are untrusted HTTP input. Decode and validation failures map to
    // one client-safe response; no partial cursor is accepted.
    throw new HTTPException(400, { message: 'Invalid cursor' });
  }
}
