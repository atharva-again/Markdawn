import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import {
  importObsidianVault,
  type ObsidianImportResult,
  type VaultFile,
} from '../utils/obsidianImport';
import { vaultImportRequestSchema } from '../utils/vaultImportValidation';

const obsidianImportRoute = new Hono();
obsidianImportRoute.use('*', requireAuth);

obsidianImportRoute.post('/', async (c) => {
  const user = c.get('user') as { id: string };

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    // JSON decoding is this HTTP adapter's boundary. Malformed input becomes
    // a 400 while vault-service failures continue to propagate unchanged.
    throw new HTTPException(400, { message: 'Invalid JSON body', cause: error });
  }
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const parsed = vaultImportRequestSchema.safeParse(body);
  if (!parsed.success)
    throw new HTTPException(400, {
      message: parsed.error.issues[0]?.message ?? 'Invalid body',
    });

  return c.json(await importObsidianVault(user.id, parsed.data.files), 201);
});

export { importObsidianVault, type ObsidianImportResult as ImportResult, type VaultFile };
export default obsidianImportRoute;
