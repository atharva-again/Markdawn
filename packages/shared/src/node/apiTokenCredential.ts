import { createHash } from 'node:crypto';
import { parseApiTokenId } from '../utils/apiToken.js';

export type ParsedApiTokenCredential = { id: string; hash: string };

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function parseApiTokenCredential(token: string): ParsedApiTokenCredential | null {
  const id = parseApiTokenId(token);
  return id ? { id, hash: hashApiToken(token) } : null;
}

export function sessionIdempotencyPrincipal(rawCredential: string): string {
  return `session:${createHash('sha256').update(rawCredential).digest('base64url')}`;
}

export function tokenIdempotencyPrincipal(tokenId: string): string {
  return `token:${tokenId}`;
}
