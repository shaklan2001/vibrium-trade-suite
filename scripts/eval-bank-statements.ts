/**
 * Bank statement ↔ payment email ↔ PO: how much of the bank account maps to the mail and the orders.
 *
 *   npx tsx --env-file=.env.local scripts/eval-bank-statements.ts --dry
 *
 * Statements: every bank-statement mail in the connected mailboxes (read-only from IMAP, since
 * mail synced before the fix did not keep the attachment), saved under data/payments/statements/.
 * Payment emails: data/payments/entries.json (--dry) or mail_payments.
 * Writes data/payments/statement-eval.json. Payroll, loans, tax and card lines are counted but never
 * listed: the output keeps only trade lines (remittances, commission, known buyers / factories).
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { buildInvoiceRegister, commissionInvoices } from "../src/lib/trade/invoiceRegister";
import { isBankStatementMail, matchStatement, parseFinacleStatement, type BankLine } from "../src/lib/mail/bankStatement";
import { decryptSecret } from "../src/lib/mail/crypto";
import type { PaymentRow } from "../src/lib/mail/paymentJobs";
import { getMailStore } from "../src/lib/mail/store";
import { getCopilotBook } from "../src/lib/trade/copilot/book";

const DRY = process.argv.includes("--dry");
const DIR = path.join(process.cwd(), "data", "payments");
const STATEMENTS = path.join(DIR, "statements");

/** Download bank statements from every connected mailbox (read-only). */
async function fetchStatements() {
  await mkdir(STATEMENTS, { recursive: true });
  const found: { mailbox: string; date: string; file: string }[] = [];
  for (const c of await getMailStore().listConnections()) {
    const sec = decryptSecret(c.secret_enc);
    const cfg = c.settings_json.imap;
    if (!cfg || sec.kind !== "password") continue;
    const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: sec.password }, logger: false });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = (await client.search({ or: [{ subject: "statement" }, { from: "stmt" }] }, { uid: true })) || [];
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const mail = await simpleParser(msg.source as Buffer);
        const from = mail.from?.value?.[0]?.address || "";
        if (!isBankStatementMail(from, mail.subject)) continue;
        for (const a of mail.attachments) {
          if (!/\.html?$/i.test(a.filename || "")) continue;
          const file = path.join(STATEMENTS, `${c.email.split("@")[0]}-${uid}-${a.filename}`);
          await writeFile(file, a.content);
          found.push({ mailbox: c.email, date: mail.date?.toISOString().slice(0, 10) || "", file });
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }
  }
  return found;
}

const pct = (k: number, n: number) => (n ? `${Math.round((100 * k) / n)}% (${k}/${n})` : "—");

async function main() {
  const statements = await fetchStatements();
  console.log(`Bank statements found: ${statements.length}`);
  const files = (await readdir(STATEMENTS)).filter((f) => /\.html?$/i.test(f));
  const lines: BankLine[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    for (const l of parseFinacleStatement(await readFile(path.join(STATEMENTS, f), "utf8"))) {
      const key = `${l.date}|${l.particulars}|${l.debit}|${l.credit}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(l);
      }
    }
  }
  const entries: PaymentRow[] = DRY
    ? JSON.parse(await readFile(path.join(DIR, "entries.json"), "utf8"))
    : await getMailStore().listPayments({ limit: 5000 });
  const book = await getCopilotBook();
  const partyNames = [
    ...new Set(
      book.deals.flatMap((d) => [
        ...d.parties.filter((p) => p.role !== "agency").map((p) => p.company || p.name),
        d.po?.buyer, d.po?.factory, d.pi?.factory, d.pi?.buyer,
      ]).filter((n): n is string => Boolean(n && n.length > 3)),
    ),
  ];
  const refText = (e: PaymentRow) => `${e.subject} ${e.attachment || ""} ${e.reference || ""} ${e.summary || ""} ${e.input?.email_text || ""}`;
  const invoices = commissionInvoices(buildInvoiceRegister(book.deals));
  const matches = matchStatement(lines, entries, refText, partyNames, invoices);

  const byKind = lines.reduce<Record<string, number>>((a, l) => ((a[l.kind] = (a[l.kind] || 0) + 1), a), {});
  const credits = matches.filter((m) => m.line.credit > 0);
  const withEmail = matches.filter((m) => m.email);
  const withPo = matches.filter((m) => m.pos.length);
  const threeWay = matches.filter((m) => m.email && m.pos.length);
  const money = (ms: typeof matches) => Math.round(ms.reduce((s, m) => s + (m.line.credit || m.line.debit), 0));
  // Payment emails that say money reached us / was sent to us: how many show on the statement?
  const period = lines.length ? { from: lines.map((l) => l.date).sort()[0]!, to: lines.map((l) => l.date).sort().at(-1)! } : null;
  const inPeriod = entries.filter(
    (e) => e.status === "done" && e.kind !== "payment_request" && period && (e.valueDate || e.mailDate.slice(0, 10)) >= period.from && (e.valueDate || e.mailDate.slice(0, 10)) <= period.to,
  );
  const confirmed = inPeriod.filter((e) => matches.some((m) => m.email?.id === e.id));

  const out = {
    generatedAt: new Date().toISOString(),
    statements: files.length,
    accounts: [...new Set(lines.map((l) => `…${l.account.slice(-4)}`))],
    period,
    lines: lines.length,
    byKind,
    nonTradeLines: lines.length - matches.length,
    tradeLines: matches.length,
    tradeCredits: credits.length,
    tradeValueInr: money(matches),
    matchedToEmail: pct(withEmail.length, matches.length),
    matchedToEmailValue: `${Math.round((100 * money(withEmail)) / Math.max(1, money(matches)))}%`,
    matchedToPo: pct(withPo.length, matches.length),
    threeWay: pct(threeWay.length, matches.length),
    threeWayValue: `${Math.round((100 * money(threeWay)) / Math.max(1, money(matches)))}%`,
    emailHow: withEmail.reduce<Record<string, number>>((a, m) => ((a[m.email!.how] = (a[m.email!.how] || 0) + 1), a), {}),
    paymentEmailsInPeriod: inPeriod.length,
    paymentEmailsOnStatement: pct(confirmed.length, inPeriod.length),
    tradeLineDetail: matches.map((m) => ({
      date: m.line.date,
      kind: m.line.kind,
      amountInr: m.line.credit || -m.line.debit,
      reference: m.line.reference,
      email: m.email ? { subject: m.email.subject.slice(0, 90), how: m.email.how, kind: m.email.kind } : null,
      pos: m.pos,
      poHow: m.poHow,
    })),
  };
  await writeFile(path.join(DIR, "statement-eval.json"), JSON.stringify(out, null, 1));
  const { tradeLineDetail, ...head } = out;
  console.log(JSON.stringify(head, null, 1));
  for (const t of tradeLineDetail) console.log(`  ${t.date} ${t.kind} ${t.amountInr} ${t.reference || ""} → ${t.email ? `${t.email.how}: ${t.email.subject}` : "no email"} · POs ${t.pos.join(",") || "-"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
