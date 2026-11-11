export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const API_URL = import.meta.env.VITE_API_URL || '';

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  params?: Record<string, string | undefined>;
  // Cognito's REST API authorizer expects the raw ID token, not a "Bearer " prefix.
  token?: string | null;
}

export function buildUrl(path: string, params?: Record<string, string | undefined>): string {
  const base = API_URL.endsWith('/') ? API_URL : `${API_URL}/`;
  const url = new URL(path.replace(/^\//, ''), base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, token } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = token;

  const res = await fetch(buildUrl(path, params), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data
        ? (data as { message?: string }).message
        : undefined) || `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, data);
  }

  return data as T;
}
