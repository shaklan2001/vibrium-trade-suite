const hits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Response | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now > cur.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  cur.count += 1;
  if (cur.count > limit) {
    return Response.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }
  return null;
}
