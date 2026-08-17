import { writeFile } from 'node:fs/promises';

const { openApiV1 } = await import('../../packages/api/src/routes/v1/openapi.ts');

await writeFile(
  new URL('../openapi.json', import.meta.url),
  `${JSON.stringify(openApiV1, null, 2)}\n`,
  'utf8',
);
