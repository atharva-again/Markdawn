import { z } from 'zod';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type SchemaContent = {
  mediaType: 'application/json' | 'application/zip' | 'multipart/form-data' | 'text/markdown';
  schema: z.ZodType;
};

export const binaryResponseSchema = z.string().meta({ format: 'binary' });

type ResponseContract = {
  description: string;
  content?: SchemaContent | readonly SchemaContent[];
  headers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

export type V1OperationContract = {
  method: HttpMethod;
  routePath: string;
  openApiPath: string;
  summary: string;
  parameters?: readonly Readonly<Record<string, unknown>>[];
  request?: SchemaContent & { required: boolean };
  responses: Readonly<Record<string, ResponseContract>>;
  security?: readonly Readonly<Record<string, readonly string[]>>[];
};

function contentDocument(
  content: SchemaContent | readonly SchemaContent[],
): Record<string, unknown> {
  const entries = Array.isArray(content) ? content : [content];
  return Object.fromEntries(
    entries.map((entry) => [
      entry.mediaType,
      {
        schema: z.toJSONSchema(entry.schema),
      },
    ]),
  );
}

export function buildOpenApiPaths(
  operations: readonly V1OperationContract[],
): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of operations) {
    const responses = Object.fromEntries(
      Object.entries(contract.responses).map(([status, response]) => [
        status,
        {
          description: response.description,
          ...(response.content ? { content: contentDocument(response.content) } : {}),
          ...(response.headers ? { headers: response.headers } : {}),
        },
      ]),
    );
    const operation = {
      summary: contract.summary,
      ...(contract.parameters ? { parameters: contract.parameters } : {}),
      ...(contract.request
        ? {
            requestBody: {
              required: contract.request.required,
              content: contentDocument(contract.request),
            },
          }
        : {}),
      responses,
      ...(contract.security ? { security: contract.security } : {}),
    };
    const path = paths[contract.openApiPath] ?? {};
    path[contract.method] = operation;
    paths[contract.openApiPath] = path;
  }
  return paths;
}

export const uuidPathParameter = (name: string): Readonly<Record<string, unknown>> => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
});

export const jsonContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'application/json',
  schema,
});

export const markdownContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'text/markdown',
  schema,
});

export const multipartContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'multipart/form-data',
  schema,
});

export const zipContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'application/zip',
  schema,
});
