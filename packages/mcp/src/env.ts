import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const currentDir = dirname(fileURLToPath(import.meta.url));

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
