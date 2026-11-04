/** Thrown when the stored grant is revoked/expired — UI asks the user to reconnect. */
export class MailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailAuthError";
  }
}

/** fetch with 429/5xx back-off (honours Retry-After, capped). */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, { ...init, cache: "no-store" });
    if (res.status !== 429 && res.status < 500) return res;
    last = res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (i + 1),
      10_000,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return last!;
}

export async function readJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  if (res.status === 401) throw new MailAuthError(`${label}: unauthorized`);
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function postForm<T>(url: string, form: Record<string, string>, label: string) {
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const code = String(body.error || "");
    const desc = String(body.error_description || text.slice(0, 200));
    if (code === "invalid_grant" || code === "interaction_required" || res.status === 401) {
      throw new MailAuthError(`${label}: ${desc || code}`);
    }
    throw new Error(`${label} failed (${res.status}): ${desc || code}`);
  }
  return body as T;
}
