import type { ApiError } from "@jobpilot/shared";

/** Thrown for every non-2xx response. Carries the HTTP status and the API's `{ error, issues }` body. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.error);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

const FALLBACK_MESSAGES: Record<number, string> = {
  400: "Some fields are invalid.",
  401: "Please sign in to continue.",
  403: "You are not allowed to do that.",
  404: "Not found.",
  409: "That conflicts with something that already exists.",
  413: "The file is too large.",
  415: "That file type is not supported.",
  422: "We could not read that file.",
  429: "Too many requests. Please try again later.",
};

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Called whenever an API request (other than `/auth/*`) returns 401, so the session can be cleared. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as multipart/form-data. */
  form?: FormData;
  signal?: AbortSignal;
}

async function readError(res: Response): Promise<ApiError> {
  const fallback = FALLBACK_MESSAGES[res.status] ?? `Request failed (${res.status}).`;
  try {
    const text = await res.text();
    const data = JSON.parse(text) as Partial<ApiError>;
    if (data && typeof data.error === "string" && data.error.length > 0) {
      return { error: data.error, issues: Array.isArray(data.issues) ? data.issues : undefined };
    }
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  return { error: fallback };
}

/** Calls the API through the same-origin `/api` rewrite. `path` starts with `/`, e.g. `/profiles`. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form; // the browser sets the multipart boundary
  } else if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, { error: "Could not reach the server. Check your connection." });
  }

  if (!res.ok) {
    const error = await readError(res);
    if (res.status === 401 && !path.startsWith("/auth/")) {
      unauthorizedListeners.forEach((l) => l());
    }
    throw new ApiRequestError(res.status, error);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.body.error;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function isApiError(err: unknown, status?: number): err is ApiRequestError {
  return err instanceof ApiRequestError && (status === undefined || err.status === status);
}
