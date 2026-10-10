import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { invokeTradeSuiteRds, isRdsProxyEnabled } from "@/lib/rdsProxy";
import type { ProcessedDealRow } from "@/lib/trade/processedDealMapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGES = new Set([
  "requirement",
  "quoting",
  "artwork",
  "samples",
  "pi_po",
  "inspection",
  "booking",
  "payment",
  "other",
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stage = searchParams.get("stage");
  if (stage && !STAGES.has(stage)) {
    return NextResponse.json({ error: "Unknown stage" }, { status: 400 });
  }

  // Preferred path for Aurora: VPC Lambda proxy (schema trade_suite only)
  if (isRdsProxyEnabled()) {
    try {
      const res = await invokeTradeSuiteRds<ProcessedDealRow[]>({
        action: "list_deals",
        stage: stage || undefined,
        limit: 500,
      });
      if (!res.success) {
        return NextResponse.json(
          {
            error: res.error || "RDS proxy failed",
            deals: [],
            counts: emptyCounts(),
            progress: await readLocalProgress(),
          },
          {
            status: 500,
            headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
          },
        );
      }
      return NextResponse.json(
        {
          deals: res.data || [],
          counts: res.counts || emptyCounts(),
          progress: await readLocalProgress(),
        },
        { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "RDS proxy failed",
          deals: [],
          counts: emptyCounts(),
          progress: await readLocalProgress(),
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
        },
      );
    }
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        error: "DATABASE_URL is not set (and RDS proxy not configured)",
        deals: [],
        counts: emptyCounts(),
        progress: await readLocalProgress(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  }

  try {
    const sql = getSql();
    const deals = stage
      ? await sql`
          SELECT
            id, po_numbers, subject, primary_stage, slot, agent_id,
            status, summary, confidence, date_start, date_end,
            message_count, doc_count, parties_json, error, processed_at,
            cost_usd, input_tokens, output_tokens, result_json,
            commercial_model, evidence_json, document_name, document_url
          FROM processed_deals
          WHERE primary_stage = ${stage}
          ORDER BY date_end DESC NULLS LAST
          LIMIT 500
        `
      : await sql`
          SELECT
            id, po_numbers, subject, primary_stage, slot, agent_id,
            status, summary, confidence, date_start, date_end,
            message_count, doc_count, parties_json, error, processed_at,
            cost_usd, input_tokens, output_tokens, result_json,
            commercial_model, evidence_json, document_name, document_url
          FROM processed_deals
          ORDER BY date_end DESC NULLS LAST
          LIMIT 500
        `;

    const stageRows = asRows<{ stage: string | null; count: number }>(
      await sql`
        SELECT primary_stage AS stage, count(*)::int AS count
        FROM processed_deals
        GROUP BY primary_stage
      `,
    );
    const statusRows = asRows<{ status: string | null; count: number }>(
      await sql`
        SELECT status, count(*)::int AS count
        FROM processed_deals
        GROUP BY status
      `,
    );
    const [{ total }] = asRows<{ total: number }>(
      await sql`SELECT count(*)::int AS total FROM processed_deals`,
    );
    const [{ spend }] = asRows<{ spend: number }>(
      await sql`SELECT coalesce(sum(cost_usd), 0)::float8 AS spend FROM processed_deals`,
    );

    const modelRows = asRows<{ model: string | null; count: number }>(
      await sql`
        SELECT commercial_model AS model, count(*)::int AS count
        FROM processed_deals
        WHERE status = 'completed'
        GROUP BY commercial_model
      `,
    );

    return NextResponse.json(
      {
        deals,
        counts: {
          total,
          byStage: Object.fromEntries(
            stageRows.map((r) => [String(r.stage ?? "unknown"), r.count]),
          ),
          byStatus: Object.fromEntries(
            statusRows.map((r) => [String(r.status ?? "unknown"), r.count]),
          ),
          byModel: Object.fromEntries(
            modelRows.map((r) => [
              String(r.model ?? "agency_commission"),
              r.count,
            ]),
          ),
          spendUsd: spend,
        },
        progress: (await readNeonProgress(sql)) ?? (await readLocalProgress()),
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Query failed",
        deals: [],
        counts: emptyCounts(),
        progress: await readLocalProgress(),
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  }
}

function emptyCounts() {
  return { total: 0, byStage: {}, byStatus: {}, spendUsd: 0 };
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function readNeonProgress(sql: ReturnType<typeof getSql>) {
  try {
    const rows = asRows<{ payload: unknown }>(
      await sql`
        SELECT payload FROM ingest_progress WHERE id = 'current' LIMIT 1
      `,
    );
    const payload = rows[0]?.payload;
    if (payload == null) return null;
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload) as unknown;
      } catch {
        return null;
      }
    }
    return payload;
  } catch {
    return null;
  }
}

async function readLocalProgress() {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "data/pst_extract/relevant/progress.json"),
      "utf8",
    );
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
