import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import { ensureDocumentInputSize } from '../utils/documentSize';
import { importMarkdownPage } from '../utils/markdownImport';

const importRoute = new Hono();

importRoute.use('*', requireAuth);

importRoute.post('/markdown', async (c) => {
  const parentId = c.req.query('parentId') || null;
  const user = c.get('user') as { id: string };

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch (error) {
    // Multipart decoding is this HTTP adapter's boundary. A malformed client
    // body is a 400; service failures continue to propagate unchanged.
    throw new HTTPException(400, { message: 'File is required', cause: error });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'File is required' });
  }
  if (!file.name.endsWith('.md')) {
    throw new HTTPException(400, { message: 'File must be a markdown file' });
  }

  ensureDocumentInputSize(file);
  return c.json(await importMarkdownPage(user.id, parentId, file.name, await file.text()), 201);
});

export { importMarkdownPage } from '../utils/markdownImport';
export default importRoute;
