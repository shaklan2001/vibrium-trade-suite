import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { jsonError, NO_STORE } from "@/lib/mail/api";
import { mailStoreConfigured } from "@/lib/mail/store";
import { dealHref } from "@/lib/trade/copilot/context";
import { getCopilotBook } from "@/lib/trade/copilot/book";
import type { ActiveSetting, PersonaKind } from "@/lib/trade/people/people";
import { getPeopleIndex, pinOwner, rebuildPeopleMessages, savePersona } from "@/lib/trade/people/peopleStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rebuilding reads every deal's mail history (~30 s).
export const maxDuration = 60;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/**
 * GET /api/people                 → { people, historyBuiltAt, stale, messagesRead, dealsRead } (null fields until first build)
 * GET /api/people?person=<id>     → { person, deals: [...] }  the deals that person is on, owner first then by weight
 */
export async function GET(req: Request) {
  const limited = checkRateLimit(req, "people", 60, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return NextResponse.json({ people: [], historyBuiltAt: null }, { headers: NO_STORE });
  try {
    const index = await getPeopleIndex();
    if (!index) return NextResponse.json({ people: [], historyBuiltAt: null }, { headers: NO_STORE });
    const personId = new URL(req.url).searchParams.get("person");
    if (!personId) {
      const { deals: _d, ...rest } = index;
      void _d;
      return NextResponse.json(rest, { headers: NO_STORE });
    }
    const person = index.people.find((p) => p.id === personId);
    if (!person) return jsonError("Unknown person", 404);
    const book = await getCopilotBook();
    const byKey = new Map(book.deals.map((d) => [d.mailboxSourceId || d.id, d]));
    const names = new Map(index.people.map((p) => [p.id, p.name]));
    const deals = Object.entries(index.deals)
      .flatMap(([key, rows]) => {
        const me = rows.find((r) => r.personId === personId);
        const d = byKey.get(key);
        if (!me || !d) return [];
        const owner = rows.find((r) => r.role === "owner");
        return [
          {
            dealKey: key,
            code: d.code,
            title: d.title,
            href: dealHref(d),
            stage: d.stage,
            updatedAt: d.updatedAt,
            role: me.role,
            score: me.score,
            sent: me.sent,
            to: me.to,
            lastAt: me.lastAt,
            lastAction: me.lastAction,
            latestSender: me.latestSender,
            pinned: me.pinned,
            owner: owner ? { id: owner.personId, name: names.get(owner.personId) || owner.personId, pinned: owner.pinned } : null,
          },
        ];
      })
      .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || b.score - a.score);
    return NextResponse.json({ person, deals, historyBuiltAt: index.historyBuiltAt }, { headers: NO_STORE });
  } catch (err) {
    console.error("[people] failed", err);
    return jsonError(err, 502);
  }
}

/**
 * POST /api/people
 *   { action: "rebuild", full? }                                       read new / changed deals' mail (full: every deal)
 *   { action: "save_persona", id, name?, title?, emails?, kind?, active?, note?, by? }
 *   { action: "pin_owner", dealKey, personId | null, by? }             set (or clear) a deal's owner by hand
 */
export async function POST(req: Request) {
  const limited = checkRateLimit(req, "people-write", 30, 60_000);
  if (limited) return limited;
  if (!mailStoreConfigured()) return jsonError("No database configured", 503);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const by = clean(body.by, 80) || "team";
    if (body.action === "rebuild") {
      const file = await rebuildPeopleMessages({ full: body.full === true });
      return NextResponse.json({ ok: true, builtAt: file.builtAt, deals: file.deals, fetched: file.fetched, messages: file.messages.length }, { headers: NO_STORE });
    }
    if (body.action === "save_persona") {
      const id = clean(body.id, 41).toLowerCase();
      if (!ID_RE.test(id)) return jsonError("Unknown person", 400);
      const emails = Array.isArray(body.emails)
        ? [...new Set(body.emails.map((e) => clean(e, 120).toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)))].slice(0, 12)
        : undefined;
      if (emails && !emails.length) return jsonError("Keep at least one email address", 400);
      const kind = body.kind === "shared" || body.kind === "person" ? (body.kind as PersonaKind) : undefined;
      const active = ["auto", "active", "inactive"].includes(String(body.active)) ? (body.active as ActiveSetting) : undefined;
      await savePersona({
        id,
        name: clean(body.name, 80) || undefined,
        title: body.title === undefined ? undefined : clean(body.title, 80),
        emails,
        kind,
        active,
        note: body.note === undefined ? undefined : clean(body.note, 500),
        updatedBy: by,
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    if (body.action === "pin_owner") {
      const dealKey = clean(body.dealKey, 400);
      if (!dealKey) return jsonError("Pick a deal", 400);
      const personId = body.personId === null ? null : clean(body.personId, 41).toLowerCase();
      if (personId !== null && !ID_RE.test(personId)) return jsonError("Unknown person", 400);
      await pinOwner(dealKey, personId, by);
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    return jsonError("Unknown action", 400);
  } catch (err) {
    console.error("[people] write failed", err);
    return jsonError(err, 502);
  }
}
