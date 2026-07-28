const API_BASE = '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function responseErrorMessage(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') return `Request failed (${status})`;
  if ('message' in body && typeof body.message === 'string') return body.message;
  if (
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return `Request failed (${status})`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, responseErrorMessage(body, res.status));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
