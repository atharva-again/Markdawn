import { describe, expect, it } from 'vitest';
import {
  ContentCommandError,
  ContentConflictError,
  contentCommandErrorStatus,
  contentCommandLogLevel,
  contentCommandPublicMessage,
} from './internalContentCommandErrors';

describe('internal content command errors', () => {
  it('preserves recognized domain conflict messages', () => {
    const error = new ContentConflictError('Page changed since it was read', '"current"');
    const status = contentCommandErrorStatus(error);
    expect(status).toBe(409);
    expect(contentCommandPublicMessage(error, status)).toBe('Page changed since it was read');
    expect(contentCommandLogLevel(error, status)).toBe('debug');
  });

  it('sanitizes unexpected failures', () => {
    const error = new Error('password authentication failed for database');
    const status = contentCommandErrorStatus(error);
    expect(status).toBe(500);
    expect(contentCommandPublicMessage(error, status)).toBe('Collaboration command failed');
    expect(contentCommandLogLevel(error, status)).toBe('error');
  });

  it('classifies expected client failures below server-error level', () => {
    for (const error of [
      new ContentCommandError(400, 'Malformed command'),
      new ContentCommandError(403, 'Page is read-only'),
      new ContentCommandError(404, 'Page not found'),
    ]) {
      const status = contentCommandErrorStatus(error);
      expect(contentCommandLogLevel(error, status)).toBe('debug');
    }
    const busy = new ContentCommandError(503, 'Busy', 'collaboration_busy', 1);
    expect(contentCommandLogLevel(busy, contentCommandErrorStatus(busy))).toBe('warn');
  });
});
