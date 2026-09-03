"use client";

export interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

interface TokenPayload {
  token: string;
  expires_at: string;
}

const TOKEN_URL = "/api/vibrium/token";

/** Browser calls go through Next.js proxy to avoid CORS. */
export const API_ROOT = "/api/proxy";

let cachedToken: string | null = null;
let expiresAtMs = 0;
let tokenPromise: Promise<string> | null = null;

function isTokenFresh() {
  return Boolean(cachedToken) && Date.now() < expiresAtMs - 60_000;
}

async function mintToken(): Promise<string> {
  const response = await fetch(TOKEN_URL, { method: "POST" });
  const payload = (await response.json()) as
    | ApiEnvelope<TokenPayload>
    | TokenPayload;

  const data =
    "data" in payload && payload.data
      ? payload.data
      : "token" in payload
        ? (payload as TokenPayload)
        : undefined;

  if (!response.ok || !data?.token) {
    const error = "error" in payload ? payload.error : undefined;
    const message = "message" in payload ? payload.message : undefined;
    throw new Error(
      error || message || `Token request failed (${response.status})`,
    );
  }

  cachedToken = data.token;
  expiresAtMs = Date.parse(data.expires_at) || Date.now() + 55 * 60_000;
  return cachedToken;
}

export async function getVibriumToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && isTokenFresh() && cachedToken) return cachedToken;
  if (!tokenPromise) {
    tokenPromise = mintToken().finally(() => {
      tokenPromise = null;
    });
  }
  return tokenPromise;
}

export function clearVibriumToken() {
  cachedToken = null;
  expiresAtMs = 0;
}

export async function vibriumRequest<T>(
  path: string,
  init: RequestInit & { params?: Record<string, string | number | undefined> } = {},
  retried = false,
): Promise<T> {
  const { params, ...rest } = init;
  const clean = path.startsWith("/") ? path.slice(1) : path;
  let url = `${API_ROOT}/${clean}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }

  // Warm token cache (proxy also mints server-side)
  await getVibriumToken(retried);

  const headers: Record<string, string> = {
    ...(rest.headers as Record<string, string> | undefined),
  };
  if (rest.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...rest, headers });

  if (response.status === 401 && !retried) {
    clearVibriumToken();
    return vibriumRequest<T>(path, init, true);
  }

  let payload: ApiEnvelope<T> & Record<string, unknown>;
  try {
    payload = (await response.json()) as ApiEnvelope<T> & Record<string, unknown>;
  } catch {
    throw new Error(`Request failed (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(
      payload.error ||
        payload.message ||
        `Request failed (${response.status})`,
    );
  }

  if (payload && typeof payload === "object" && "success" in payload) {
    if (payload.success === false) {
      throw new Error(payload.error || payload.message || "Request failed");
    }
    if (payload.data !== undefined) return payload.data;
  }

  return payload as unknown as T;
}

export function vibriumGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
) {
  return vibriumRequest<T>(path, { method: "GET", params });
}

export function vibriumPost<T>(path: string, body?: unknown) {
  return vibriumRequest<T>(path, {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function vibriumPatch<T>(path: string, body?: unknown) {
  return vibriumRequest<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body ?? {}),
  });
}

export function vibriumDelete<T>(path: string) {
  return vibriumRequest<T>(path, { method: "DELETE" });
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function pollUntil<T>(
  fetchFn: () => Promise<T>,
  isDone: (value: T) => boolean,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const started = Date.now();
  let last = await fetchFn();
  while (!isDone(last)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for job to finish");
    }
    await sleep(intervalMs);
    last = await fetchFn();
  }
  return last;
}
