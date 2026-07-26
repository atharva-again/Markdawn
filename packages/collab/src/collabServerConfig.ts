import type { Logger } from '@logtape/logtape';
import type { Pool } from 'pg';

export interface CollabServerConfig {
  port: number;
  pool: Pool;
  logger: Logger;
  debounceMs?: number;
  maxDebounceMs?: number;
  databaseUrl?: string;
  permissionRevalidationMs?: number;
  applicationFenceTimeoutMs?: number;
  maxPayloadBytes?: number;
  maxAwarenessPayloadBytes?: number;
  maxDocumentBytes?: number;
  internalSecret: string;
  maxConcurrentContentCommands?: number;
  maxContentCommandsPerDocument?: number;
}
