import { parseMcpPublicUrl } from '../packages/shared/src/utils/mcpPublicUrl.js';

const value = process.env.MCP_PUBLIC_URL;
if (!value) throw new Error('MCP_PUBLIC_URL is empty');
parseMcpPublicUrl(value, true);
