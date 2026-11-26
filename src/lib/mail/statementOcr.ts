/**
 * Scanned / printed-to-image bank statements → table rows, for statementParse's table reader.
 *
 * Plain OCR reads a ruled statement table line by line, so a row whose date wraps over three lines
 * ("06-" / "Nov-" / "2026") or whose narration wraps comes out shredded, and the borders become
 * stray "|" and "[" characters inside the amounts. Here each page is rendered, the table's ruled
 * lines are found in the pixels, the lines are painted out, the page is OCR'd once with word
 * positions, and every word is put in the cell (row band × column) it sits in:
 *
 *   02-Nov-2026 | 10001 | TRF/ACME TRAVELS PVT LTD/ICI | 250000.00 | 0.00 | 750000.00
 *
 * Text outside any table (the statement heading, the period, the account) is kept as plain lines.
 * Server only.
 */
import os from "node:os";
import { HEADER } from "./statementParse";

/** Render scale: 3× a 72-dpi page is ~216 dpi, enough for 8-pt statement print. */
const SCALE = 3;
/** Rough worst case per page (render + OCR), to stop before the request's deadline. */
export const TABLE_PAGE_BUDGET_MS = 9_000;
const DARK = 160;

type HLine = { y: number; x1: number; x2: number };
type VLine = { x: number; y1: number; y2: number };

/** Ruled lines: dark runs much longer than any glyph stroke. */
function findLines(px: Uint8ClampedArray, w: number, h: number) {
  const lum = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j]! * 299 + px[j + 1]! * 587 + px[j + 2]! * 114) / 1000;
  const minH = Math.round(w * 0.08);
  // A row of 8-pt print is ~12 pt tall and its column rules may stop at every row line.
  const minV = 7 * SCALE;

  // A rule is thin: light paper a few pixels to one side of it. Inside a filled area (a coloured
  // heading row) both sides are dark, so only the fill's edges count.
  const t = SCALE + 1;
  // Letters touching a rule break its run for a few pixels; a short break does not end the rule.
  const bridge = 2 * SCALE;
  const light = (i: number) => i < 0 || i >= lum.length || lum[i]! >= DARK;
  const hRuns: HLine[] = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    let lastInk = -1;
    let inked = 0;
    for (let x = 0; x <= w; x++) {
      const i = y * w + x;
      const d = x < w && lum[i]! < DARK && (light(i - t * w) || light(i + t * w));
      if (d) {
        if (start < 0) {
          start = x;
          inked = 0;
        }
        lastInk = x;
        inked++;
      } else if (start >= 0 && (x - lastInk > bridge || x === w)) {
        // A rule is nearly solid; the bottom edge of a line of letters is not.
        const len = lastInk - start + 1;
        if (len >= minH && inked >= len * 0.9) hRuns.push({ y, x1: start, x2: lastInk });
        start = -1;
      }
    }
  }
  const vRuns: VLine[] = [];
  for (let x = 0; x < w; x++) {
    let start = -1;
    let lastInk = -1;
    for (let y = 0; y <= h; y++) {
      const i = y * w + x;
      const d = y < h && lum[i]! < DARK && ((x >= t && light(i - t)) || (x + t < w && light(i + t)));
      if (d) {
        if (start < 0) start = y;
        lastInk = y;
      } else if (start >= 0 && (y - lastInk > 1 || y === h)) {
        if (lastInk - start + 1 >= minV) vRuns.push({ x, y1: start, y2: lastInk });
        start = -1;
      }
    }
  }
  return { hRuns, vRuns };
}

/** Runs a few pixels apart (line thickness, double borders) are one line. */
function mergeH(runs: HLine[], gap: number): HLine[] {
  const out: HLine[] = [];
  for (const r of [...runs].sort((a, b) => a.y - b.y || a.x1 - b.x1)) {
    const hit = out.find((o) => r.y - o.y <= gap && r.x1 <= o.x2 && r.x2 >= o.x1);
    if (hit) {
      hit.x1 = Math.min(hit.x1, r.x1);
      hit.x2 = Math.max(hit.x2, r.x2);
    } else out.push({ ...r });
  }
  return out;
}

function mergeV(runs: VLine[], gap: number): VLine[] {
  const out: VLine[] = [];
  for (const r of [...runs].sort((a, b) => a.x - b.x || a.y1 - b.y1)) {
    const hit = out.find((o) => Math.abs(r.x - o.x) <= gap && r.y1 <= o.y2 + gap && r.y2 >= o.y1 - gap);
    if (hit) {
      hit.y1 = Math.min(hit.y1, r.y1);
      hit.y2 = Math.max(hit.y2, r.y2);
    } else out.push({ ...r });
  }
  return out;
}

/** "06- Nov- 2026" → "06-Nov-2026"; "1,00,000. 00" → "1,00,000.00" (cells wrap inside narrow columns). */
function tidyCell(s: string) {
  return s
    .replace(/[|[\]{}]/g, " ")
    .replace(/(\d)\s*-\s+(?=[A-Za-z0-9])/g, "$1-")
    .replace(/([A-Za-z]{3})-\s+(?=\d)/g, "$1-")
    .replace(/(\d)\s*([.,])\s+(?=\d)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * An OCR'd amount → "1234567.89" (with "-" for a Dr balance). Statement print mixes Indian and
 * Western grouping and OCR swaps "," and "."; the separator before the last two digits is the
 * decimal point, every other one is grouping.
 */
export function tidyAmount(raw: string) {
  const s = raw.replace(/\s+/g, "");
  const dr = /D[r]?$/i.test(s);
  const body = s.replace(/(?:Cr?|Dr?)$/i, "").replace(/[()]/g, "");
  if (!/^-?[\d.,]*\d[\d.,]*$/.test(body)) return raw.trim();
  const neg = body.startsWith("-") || dr;
  const digits = body.replace(/^-/, "");
  const m = /^(.*?)[.,](\d{1,2})$/.exec(digits);
  const whole = (m ? m[1]! : digits).replace(/[.,]/g, "");
  if (!whole) return raw.trim();
  const value = m ? `${whole}.${m[2]!.padEnd(2, "0")}` : whole;
  return `${neg ? "-" : ""}${value}`;
}

type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;
let cellWorker: Promise<Worker> | null = null;
/** A worker of its own: cell reads change the page-segmentation mode and character whitelist. */
function worker() {
  cellWorker ||= import("tesseract.js").then(({ createWorker }) => createWorker("eng", 1, { cachePath: os.tmpdir() }));
  return cellWorker;
}

export async function stopStatementOcr() {
  if (!cellWorker) return;
  const w = await cellWorker;
  cellWorker = null;
  await w.terminate();
}

type Canvas = import("@napi-rs/canvas").Canvas;
type Mode = "text" | "number" | "block";
let lastMode: Mode | null = null;

/** OCR one region of the page (a cell, or the text between tables). Blank regions are not sent. */
async function readRegion(page: Canvas, lum: Uint8Array, x: number, y: number, w: number, h: number, mode: Mode) {
  if (w < 4 || h < 4) return "";
  // Blank or not, judged against the cell's own background (white, a tinted row, a coloured heading).
  const hist = new Uint32Array(256);
  let n = 0;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++, n++) hist[lum[yy * page.width + xx]!]!++;
  let acc = 0;
  let bg = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= n * 0.5) {
      bg = v;
      break;
    }
  }
  const dark = bg < 110;
  let ink = 0;
  for (let v = 0; v < 256; v++) if (dark ? v > bg + 70 : v < bg - 70) ink += hist[v]!;
  if (ink < 12) return "";
  const { createCanvas } = await import("@napi-rs/canvas");
  // Black text on white whatever the cell's fill: ink is what stands out from the background.
  const pad = 12;
  const crop = createCanvas(w + pad * 2, h + pad * 2);
  const c = crop.getContext("2d");
  const out = c.createImageData(crop.width, crop.height);
  out.data.fill(255);
  // A contrast stretch from the ink to the background (letter edges keep their grey, which OCR needs).
  const span = 180;
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const v = lum[(y + yy) * page.width + x + xx]!;
      const t = dark ? (Math.min(255, bg + span) - v) / span : (v - Math.max(0, bg - span)) / span;
      const o = ((yy + pad) * crop.width + xx + pad) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = Math.max(0, Math.min(255, Math.round(t * 255)));
    }
  c.putImageData(out, 0, 0);
  const ocr = await worker();
  if (mode !== lastMode) {
    await ocr.setParameters({
      tessedit_pageseg_mode: (mode === "block" ? "3" : "6") as never,
      tessedit_char_whitelist: mode === "number" ? "0123456789.,-()CrDr" : "",
    });
    lastMode = mode;
  }
  const { data } = await ocr.recognize(crop.toBuffer("image/png"));
  return data.text;
}

const ROLES: (keyof typeof HEADER)[] = ["date", "desc", "debit", "credit", "balance", "amount", "type"];

/** Which columns of a header row are worth reading, and which hold numbers. */
function columnRoles(cells: string[]) {
  const hits = ROLES.filter((r) => cells.some((c) => HEADER[r].test(c))).length;
  if (hits < 3) return null;
  const need = new Set<number>();
  const numeric = new Set<number>();
  for (const r of ROLES) {
    const i = cells.findIndex((c) => HEADER[r].test(c) && !(r === "date" && /value/i.test(c)) && !(r === "desc" && /date/i.test(c)));
    if (i < 0) continue;
    need.add(i);
    if (r === "debit" || r === "credit" || r === "balance" || r === "amount") numeric.add(i);
  }
  const date = cells.findIndex((c) => HEADER.date.test(c) && !/value/i.test(c));
  const balance = cells.findIndex((c) => HEADER.balance.test(c));
  return { need, numeric, date, balance };
}

const sameLayout = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= 4 * SCALE);

type Row = { y: number; cells?: string[]; text?: string };

/** The transaction table's layout and the last row read, carried from page to page: later pages may not
 * repeat the header, and a row cut by the page break goes on at the top of the next page. */
export type TableCarry = {
  layout?: { cols: number[]; need: Set<number>; numeric: Set<number>; date: number; balance: number };
  last?: Row;
};

/** One rendered page (PNG) → its rows: table rows as cells, the text between tables as plain lines. */
async function pageRows(png: Uint8Array, carry: TableCarry): Promise<Row[]> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(Buffer.from(png));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { width: w, height: h } = canvas;
  const textDone = Boolean(carry.layout);
  const { hRuns, vRuns } = findLines(ctx.getImageData(0, 0, w, h).data, w, h);
  const gap = 3 * SCALE;
  // A rule is 1–3 px thick; runs further apart are different lines (a rule and the letters above it).
  const hLines = mergeH(hRuns, 2);
  // Double borders (cell spacing) are a few points apart; no real column is that narrow.
  const vLines = mergeV(vRuns, 6 * SCALE);

  // Row bands: between consecutive horizontal rules, and the table's top / bottom edge where a page
  // break cut a row (the column rules run on past the last horizontal rule).
  // A row rule runs across the table's columns (whole, or one piece per cell); the flat bottoms of a
  // line of capitals stay inside one cell. So a rule must cover a third of the page at its height.
  // And it meets the column rules (a run along the serifs of a line of text stops short of them,
  // inside the cell's padding). Only rules taller than a letter count as column rules here.
  const posts = vLines.filter((v) => v.y2 - v.y1 >= 15 * SCALE);
  const meetsPost = (l: HLine) => posts.some((v) => v.y1 - gap <= l.y && v.y2 + gap >= l.y && v.x >= l.x1 - 3 && v.x <= l.x2 + 3);
  const across = (y: number) => {
    const spans = hLines.filter((l) => Math.abs(l.y - y) <= 2 && meetsPost(l)).sort((a, b) => a.x1 - b.x1);
    let covered = 0;
    let end = -1;
    for (const l of spans) {
      covered += Math.max(0, l.x2 - Math.max(l.x1, end + 1) + 1);
      end = Math.max(end, l.x2);
    }
    return covered >= w / 3;
  };
  // Where a page break cut the table, its column rules all stop at the same height. Letters are upright
  // strokes too ("1", "I", brackets), so only rules taller than a letter count, and at least three.
  // Stacked letters of a two-line narration can touch and look like a tall stroke, so the outer
  // borders (leftmost and rightmost rules) must end there too: text never reaches them.
  const left = Math.min(...posts.map((v) => v.x));
  const right = Math.max(...posts.map((v) => v.x));
  const endsAt = (y: number) => posts.filter((v) => Math.abs(v.y1 - y) <= gap || Math.abs(v.y2 - y) <= gap);
  const tableEdges = [...new Set(posts.flatMap((v) => [v.y1, v.y2]))].filter((y) => {
    const at = endsAt(y);
    return at.length >= 3 && at.some((v) => v.x - left <= 6 * SCALE) && at.some((v) => right - v.x <= 6 * SCALE);
  });
  const edges = [...hLines.filter((l) => across(l.y)).map((l) => l.y), ...tableEdges].sort((a, b) => a - b);
  const ys: number[] = [];
  for (const y of edges) if (!ys.length || y - ys[ys.length - 1]! > gap) ys.push(y);
  // Bands and the column rules crossing each one.
  type Band = { top: number; bottom: number; cols: number[] };
  const bands: Band[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const top = ys[i]!;
    const bottom = ys[i + 1]!;
    if (bottom - top < 6 * SCALE) {
      // No row is this thin: a false rule (the flat bottoms of a line of capitals) cut the row above.
      const prev = bands[bands.length - 1];
      if (prev && prev.bottom === top && bottom - top > gap) prev.bottom = bottom;
      continue;
    }
    const mid = (top + bottom) / 2;
    // A rule broken by a gap is two runs at the same x: one column edge.
    const cols: number[] = [];
    // A column rule runs the height of the row; an upright letter stroke does not.
    const need = (bottom - top) * 0.8;
    for (const x of vLines
      .filter((v) => v.y1 <= mid && v.y2 >= mid && Math.min(v.y2, bottom) - Math.max(v.y1, top) >= need)
      .map((v) => v.x)
      .sort((a, b) => a - b))
      if (!cols.length || x - cols[cols.length - 1]! > 6 * SCALE) cols.push(x);
    if (cols.length >= 2) bands.push({ top, bottom, cols });
  }
  // Rows of one table share its outer edges. A column edge is real when it shows up in many of the
  // table's rows (a tall letter stroke shows up in one); every row of the table gets the same edges.
  const near = (a: number, b: number) => Math.abs(a - b) <= 4 * SCALE;
  for (let i = 0; i < bands.length; ) {
    let j = i + 1;
    const first = bands[i]!.cols[0]!;
    const lastCol = bands[i]!.cols[bands[i]!.cols.length - 1]!;
    while (j < bands.length && near(bands[j]!.cols[0]!, first) && near(bands[j]!.cols[bands[j]!.cols.length - 1]!, lastCol) && bands[j]!.top - bands[j - 1]!.bottom <= gap) j++;
    const group = bands.slice(i, j);
    if (group.length >= 3) {
      const votes: { x: number; n: number }[] = [];
      for (const b of group)
        for (const x of b.cols) {
          const v = votes.find((o) => near(o.x, x));
          if (v) v.n++;
          else votes.push({ x, n: 1 });
        }
      const cols = votes.filter((v) => v.n >= Math.max(2, group.length * 0.3)).map((v) => v.x).sort((a, b) => a - b);
      for (const b of group) b.cols = cols;
    }
    i = j;
  }

  // Paint the rules out so Tesseract does not read them as "|", "[" or "1". Only the rules used as
  // row and column edges: a run along the bottoms of a line of letters is part of the letters.
  const rowEdges = new Set(bands.flatMap((b) => [b.top, b.bottom]));
  const colEdges = [...new Set(bands.flatMap((b) => b.cols))];
  ctx.fillStyle = "#ffffff";
  for (const r of hRuns) if ([...rowEdges].some((y) => Math.abs(r.y - y) <= gap) && across(r.y)) ctx.fillRect(r.x1, r.y - 1, r.x2 - r.x1 + 1, 3);
  for (const r of vRuns) if (colEdges.some((x) => Math.abs(r.x - x) <= 6 * SCALE)) ctx.fillRect(r.x - 1, r.y1, 3, r.y2 - r.y1 + 1);
  const px = ctx.getImageData(0, 0, w, h).data;
  const lum = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j]! * 299 + px[j + 1]! * 587 + px[j + 2]! * 114) / 1000;

  // Where a row rule was missed, one band holds several transactions: split it at the date lines.
  const DATE_TOKEN = /\b\d{1,2}[-/.](?:\d{1,2}|[A-Za-z]{3})[-/.]\d{2,4}\b/g;
  const queue = [...bands];
  const out: Row[] = [];
  const covered: [number, number][] = [];
  let heading: { cells: string[]; row: Row } | null = null;
  while (queue.length) {
    const { top, bottom, cols } = queue.shift()!;
    if (cols.length < 3) continue;
    covered.push([top, bottom]);
    const layout = carry.layout && sameLayout(cols, carry.layout.cols) ? carry.layout : null;
    if (layout && bottom - top > 14 * SCALE) {
      const dc = layout.date;
      const x0 = cols[dc]! + 3;
      const x1 = cols[dc + 1]! - 3;
      const dates = ((await readRegion(canvas, lum, x0, top + 3, x1 - x0, bottom - top - 6, "text")).match(DATE_TOKEN) || []).length;
      // Every transaction has one running balance: a second balance means a second row.
      const b = layout.balance;
      const balances =
        b >= 0 && b + 1 < cols.length
          ? tidyCell(await readRegion(canvas, lum, cols[b]! + 3, top + 3, cols[b + 1]! - cols[b]! - 6, bottom - top - 6, "number")).split(" ").filter((t) => /\d[.,]\d{2}/.test(t)).length
          : 0;
      const count = Math.max(dates, balances);
      if (count >= 2) {
        // Text lines of the date column: runs of rows with ink, a line's gap apart.
        const lines: [number, number][] = [];
        for (let y = top + 3; y < bottom - 3; y++) {
          let inkRow = false;
          for (let x = x0; x < x1 && !inkRow; x++) inkRow = lum[y * w + x]! < 150;
          if (!inkRow) continue;
          const last = lines[lines.length - 1];
          if (last && y - last[1] <= 3 * SCALE) last[1] = y;
          else lines.push([y, y]);
        }
        if (lines.length === count) {
          covered.pop();
          const cuts = [top, ...lines.slice(1).map((l, k) => Math.round((lines[k]![1] + l[0]) / 2)), bottom];
          queue.unshift(...cuts.slice(0, -1).map((y, k) => ({ top: y, bottom: cuts[k + 1]!, cols })));
          continue;
        }
      }
    }
    const known = layout;
    const cells: string[] = [];
    for (let c = 0; c + 1 < cols.length; c++) {
      if (known && !known.need.has(c)) {
        cells.push("");
        continue;
      }
      const raw = await readRegion(canvas, lum, cols[c]! + 3, top + 3, cols[c + 1]! - cols[c]! - 6, bottom - top - 6, known?.numeric.has(c) ? "number" : "text");
      const cell = tidyCell(raw.replace(/\n+/g, " "));
      cells.push(known?.numeric.has(c) ? tidyAmount(cell) : cell);
    }
    if (cells.every((c) => !c)) continue;
    // No date in a known table: the rest of the row above (wrapped narration, or cut by the page break).
    if (known && !cells[known.date] && cells.some((c) => /\b(?:page )?total\b/i.test(c))) continue;
    if (known && !cells[known.date] && carry.last?.cells?.length === cells.length) {
      carry.last.cells = carry.last.cells.map((c, k) => [c, cells[k]].filter(Boolean).join(" "));
      continue;
    }
    let roles = known ? null : columnRoles(cells);
    // A heading set on two lines can come out as two bands ("Reverse" / "Sweep"): join them.
    if (!roles && !known && heading && heading.cells.length === cells.length) {
      const joined = heading.cells.map((c, k) => [c, cells[k]].filter(Boolean).join(" "));
      roles = columnRoles(joined);
      if (roles) {
        heading.row.cells = joined;
        carry.layout = { cols, ...roles };
        heading = null;
        continue;
      }
    }
    if (roles) carry.layout = { cols, ...roles };
    const row: Row = { y: top, cells };
    out.push(row);
    carry.last = row;
    heading = !known && !roles && !cells.some((c) => DATE_TOKEN.test(c)) ? { cells, row } : null;
    DATE_TOKEN.lastIndex = 0;
  }
  // Text between the tables (statement heading, period, account): read as plain lines. Only until
  // the transaction table is found: later pages repeat a heading and end in long notes nobody reads.
  if (textDone) return out.sort((a, b) => a.y - b.y);
  covered.sort((a, b) => a[0] - b[0]);
  let from = 0;
  for (const [top, bottom] of [...covered, [h, h] as [number, number]]) {
    if (top - from > 8 * SCALE) {
      const text = await readRegion(canvas, lum, 0, from, w, top - from, "block");
      for (const line of text.split("\n").map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean)) out.push({ y: from, text: line });
    }
    from = Math.max(from, bottom);
  }
  return out.sort((a, b) => a.y - b.y);
}

const rowText = (r: Row) => (r.cells ? r.cells.join(" | ") : r.text || "");

/** A PDF with no text layer → text with table rows, page by page until `maxPages` or the deadline. */
export async function tableOcrPdf(buf: Buffer, opts: { deadline: number; maxPages?: number }) {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const last = Math.min(pdf.numPages, opts.maxPages ?? 40);
  const pages: Row[][] = [];
  const carry: TableCarry = {};
  for (let p = 1; p <= last; p++) {
    if (p > 1 && Date.now() + TABLE_PAGE_BUDGET_MS > opts.deadline) break;
    const png = await renderPageAsImage(pdf, p, { canvasImport: () => import("@napi-rs/canvas"), scale: SCALE });
    pages.push(await pageRows(new Uint8Array(png), carry));
  }
  // Rows are joined to after their page is read, so the text is built at the end.
  const text = pages.map((rows, i) => `--- page ${i + 1}\n${rows.map(rowText).filter(Boolean).join("\n")}`).join("\n");
  return { text, pages: pdf.numPages, pagesRead: pages.length };
}

/** A photo / single image of a statement → text with table rows. */
export async function tableOcrImage(buf: Buffer) {
  const rows = await pageRows(new Uint8Array(buf), {});
  return { text: rows.map(rowText).filter(Boolean).join("\n"), pages: 1, pagesRead: 1 };
}
