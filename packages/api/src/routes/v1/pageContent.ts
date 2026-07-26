import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireV1Scope } from '../../middleware/v1Auth';
import { readPageMarkdown, replacePageMarkdown } from '../../utils/collaborationContentClient';
import { pageOperations } from './pageContracts';
import { requireUuid } from './pageModel';
import { v1MarkdownBodyLimit } from './requestLimits';
import { readUtf8Request } from './requestValidation';

const pageContentRoute = new Hono();

pageContentRoute.get(pageOperations.readContent.routePath, async (c) => {
  const principal = c.get('v1Principal');
  const pageId = requireUuid(c.req.param('id'), 'page ID');
  const content = await readPageMarkdown(pageId, principal);
  c.header('Content-Type', 'text/markdown; charset=UTF-8');
  c.header('ETag', content.etag);
  return c.body(content.markdown);
});

pageContentRoute.put(
  pageOperations.replaceContent.routePath,
  requireV1Scope('pages:write'),
  v1MarkdownBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const ifMatch = c.req.header('if-match');
    if (!ifMatch) throw new HTTPException(428, { message: 'If-Match is required' });
    const result = await replacePageMarkdown(pageId, principal, await readUtf8Request(c), ifMatch);
    c.header('ETag', result.etag);
    return c.body(null, 204);
  },
);

export default pageContentRoute;
