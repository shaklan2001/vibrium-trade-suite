import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { invokeTradeSuiteRds, isRdsProxyEnabled } from "@/lib/rdsProxy";
import {
  mapProcessedDeal,
  type EvidencePayload,
  type ProcessedDealRow,
} from "@/lib/trade/processedDealMapper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Full source-email evidence for one mailbox deal.
 * GET /api/processed-deals/evidence?id=po:8615
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    let row: ProcessedDealRow | undefined;

    if (isRdsProxyEnabled()) {
      const res = await invokeTradeSuiteRds<ProcessedDealRow>({
        action: "get_evidence",
        id,
      });
      if (!res.success) {
        const status = res.error === "Not found" ? 404 : 500;
        return NextResponse.json({ error: res.error || "Failed" }, { status });
      }
      row = res.data;
    } else {
      if (!process.env.DATABASE_URL) {
        return NextResponse.json(
          { error: "DATABASE_URL is not set (and RDS proxy not configured)" },
          { status: 503 },
        );
      }
      const sql = getSql();
      const rows = (await sql`
        SELECT
          id, po_numbers, subject, primary_stage, slot, agent_id,
          status, summary, confidence, date_start, date_end,
          message_count, doc_count, parties_json, error, processed_at,
          cost_usd, result_json, commercial_model, evidence_json,
          document_name, document_url
        FROM processed_deals
        WHERE id = ${id}
        LIMIT 1
      `) as ProcessedDealRow[];
      row = Array.isArray(rows) ? rows[0] : undefined;
    }

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const evidence = (row.evidence_json || {}) as EvidencePayload;
    const deal = mapProcessedDeal(row, { fullEvidence: true });

    return NextResponse.json(
      {
        id: row.id,
        commercial_model: row.commercial_model,
        slot: row.slot,
        document_name: row.document_name,
        document_url: row.document_url,
        evidence,
        result: row.result_json,
        deal,
        sources: deal?.sources || [],
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 500 },
    );
  }
}
