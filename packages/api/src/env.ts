import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireCollaborationInternalSecret as validateCollaborationInternalSecret } from '@markdawn/shared';
import { config } from 'dotenv';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const uploadsDir = resolve(currentDir, '..', 'uploads');

const candidateEnvPaths = [
  resolve(process.cwd(), '.env'),
  resolve(currentDir, '../.env'),
  resolve(currentDir, '../../../.env'),
];

const selectedEnvPath = candidateEnvPaths.find((envPath) => existsSync(envPath));

if (selectedEnvPath) {
  config({ path: selectedEnvPath });
} else {
  config();
}

export function requireCollaborationInternalSecret(): string {
  return validateCollaborationInternalSecret(process.env.COLLAB_INTERNAL_SECRET);
}
