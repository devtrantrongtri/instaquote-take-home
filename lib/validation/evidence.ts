import type { SourceNumber } from "../contracts";
import type { CandidateCell, CandidateNumericField, Column, PageExtractionResult, SourceFragment, SourceQuote } from "../extraction/types";

/** Independent view derived from the reader ledger, not candidate cell assignments. */
export type CheckedLine = {
  source: SourceQuote;
  fragments: SourceFragment[];
  y: number;
  context: SourceQuote[];
  table?: CheckedTable;
  rowLike: boolean;
};
export type CheckedTable = { line: CheckedLine; columns: { field: Column; x: number }[] };
export type SourceView = { lines: CheckedLine[]; tables: CheckedTable[] };
const x = (f: SourceFragment) => f.transform[4];
const y = (f: SourceFragment) => f.transform[5];
const label = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const heading = /^(?:Multi-Site\b|Site\s+\d|Summary\s*-|Returns Note\b|Credit Adjustment\b|Signed Acceptance\b|Packing List\b|Invoice\b|Delivery (?:Docket|Note)\b|Delivered to:)/i;
const boundary = /^(?:Total\b|Note:|Driver notes:|Summary:|Freight\b|Page\s+\d+\s+of\s+\d+)/i;

export function sourceQuote(page: number, fragments: readonly SourceFragment[]): SourceQuote {
  let text = "";
  for (const fragment of fragments) {
    if (text && fragment.str && !/\s$/.test(text) && !/^\s/.test(fragment.str)) text += " ";
    text += fragment.str;
  }
  return { page, sourceText: text, fragmentIndices: fragments.map(f => f.index) };
}
export function sameQuote(actual: SourceQuote | undefined, expected: SourceQuote): boolean {
  return !!actual && actual.page === expected.page && actual.sourceText === expected.sourceText
    && Array.isArray(actual.fragmentIndices) && actual.fragmentIndices.length === expected.fragmentIndices.length
    && actual.fragmentIndices.every((id, i) => id === expected.fragmentIndices[i]);
}
export function sameContext(actual: SourceQuote[] | undefined, expected: SourceQuote[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((q, i) => sameQuote(q, expected[i]));
}

export function sourceView(page: PageExtractionResult): SourceView {
  if (page.reader.status !== "text") return { lines: [], tables: [] };
  // A copied/frozen parser ledger is useful, but cannot override the reader source.
  if (page.ledger.length !== page.reader.fragments.length || page.ledger.some((f, i) => {
    const original = page.reader.status === "text" ? page.reader.fragments[i] : undefined;
    return !original || JSON.stringify(f) !== JSON.stringify(original);
  }) || new Set(page.ledger.map(f => f.index)).size !== page.ledger.length) {
    throw new Error("Source ledger does not match the reader.");
  }
  const groups: SourceFragment[][] = [];
  for (const f of [...page.ledger].filter(f => f.str).sort((a, b) => y(b) - y(a) || x(a) - x(b))) {
    if (f.str.trim() && (f.transform.length !== 6 || !f.transform.every(Number.isFinite)
      || f.dir !== "ltr" || f.transform[0] <= 0 || f.transform[3] <= 0
      || Math.abs(f.transform[1]) > 0.01 || Math.abs(f.transform[2]) > 0.01
      || !Number.isFinite(f.width) || f.width < 0)) throw new Error("Unsupported source geometry.");
    const group = groups.find(g => Math.abs(y(g[0]) - y(f)) <= Math.max(0.5, Math.min(g[0].height, f.height) * 0.2));
    if (group) group.push(f); else groups.push([f]);
  }
  const lines: CheckedLine[] = groups.map(group => {
    const fragments = group.sort((a, b) => x(a) - x(b) || a.index - b.index);
    return { source: sourceQuote(page.reader.page, fragments), fragments, y: y(fragments[0]), context: [], rowLike: false };
  });
  const tables: CheckedTable[] = [];
  let active: CheckedTable | undefined;
  let context: SourceQuote[] = [];
  for (const line of lines) {
    const text = line.source.sourceText.trim();
    if (heading.test(text)) context = /^Delivered to:/i.test(text) ? [...context, line.source] : [line.source];
    line.context = [...context];
    const parts = line.fragments.filter(f => f.str.trim());
    const labels = parts.map(f => label(f.str)).join("|");
    let fields: Column[] | undefined;
    if (labels === "item|description|qty|unit|unit price|line total") fields = ["item", "description", "quantity", "unit", "unitPrice", "lineTotal"];
    if (labels === "item|description|qty|weight|unit price") fields = ["item", "description", "quantity", "weightRaw", "unitPrice"];
    if (fields) {
      active = { line, columns: fields.map((field, i) => ({ field, x: x(parts[i]) })) };
      tables.push(active);
      continue;
    }
    if (heading.test(text) || boundary.test(text) || /\bDescription\b.*\bQty\b/i.test(text)) { active = undefined; continue; }
    if (!active || !text || /^[-_]+$/.test(text)) continue;
    line.table = active;
    const desc = active.columns[1].x, qty = active.columns[2].x;
    line.rowLike = (x(parts[0]) < desc - 2 && /^\d+\b/.test(text)) || parts.some(f => x(f) >= qty - 2);
  }
  return { lines, tables };
}

export function lineFor(view: SourceView, quote: SourceQuote | undefined): CheckedLine | undefined {
  return view.lines.find(line => sameQuote(quote, line.source));
}
export function cellSource(line: CheckedLine, field: Column): SourceQuote | undefined {
  const columns = line.table?.columns;
  const i = columns?.findIndex(col => col.field === field) ?? -1;
  if (!columns || i < 0) return;
  const left = columns[i].x - 2, right = (columns[i + 1]?.x ?? Infinity) - 2;
  const fragments = line.fragments.filter(f => f.str.trim() && x(f) >= left && x(f) < right);
  if (fragments.some((f, j) => x(f) + f.width > right || (j > 0 && x(fragments[j - 1]) + fragments[j - 1].width > x(f) + 0.5))) return;
  return sourceQuote(line.source.page, fragments);
}

const numberBody = String.raw`[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const bareNumber = new RegExp(`^${numberBody}$`);
const moneyCell = new RegExp(`^\\s*(\\$${numberBody})(?:\\s+(\\/[^\\s]+))?\\s*$`);

/** Full-token grammar; normalization only after source and role checks by caller. */
export function normalizeNumber(raw: string, money = false): SourceNumber | undefined {
  if (typeof raw !== "string" || (money && !raw.startsWith("$"))) return;
  const digits = money ? raw.slice(1) : raw;
  if (!bareNumber.test(digits)) return;
  let value = digits.replaceAll(",", "").replace(/^\+/, "");
  value = value.replace(/^(-?)0+(?=\d)/, "$1");
  return { raw, value };
}
export function tokenMatches(token: CandidateNumericField | undefined, quote: SourceQuote, raw: string, start: number): boolean {
  return !!token && sameQuote(token.source, quote) && token.raw === raw
    && Number.isInteger(token.start) && token.start === start && token.end === start + raw.length
    && quote.sourceText.slice(token.start, token.end) === raw;
}
export function validatedNumber(cell: CandidateCell | undefined, expected: SourceQuote, money: boolean, allowBasis = false): SourceNumber | undefined {
  if (!cell || !sameQuote(cell.source, expected)) return;
  const match = money ? expected.sourceText.match(moneyCell) : expected.sourceText.match(new RegExp(`^\\s*(${numberBody})\\s*$`));
  if (!match || (!allowBasis && match[2]) || cell.priceBasis !== match[2]) return;
  const raw = match[1], start = expected.sourceText.indexOf(raw);
  if (!tokenMatches(cell.numeric, expected, raw, start)) return;
  return normalizeNumber(raw, money);
}

export type ValidClaim = { type: "printed_total" | "pallet_count"; value: SourceNumber; source: SourceQuote; context: SourceQuote[]; line: CheckedLine; qualifier?: "loaded" | "unloaded" };
export function validateClaim(claim: PageExtractionResult["claims"][number], view: SourceView, page: number): ValidClaim | undefined {
  const line = lineFor(view, claim.source);
  if (!line || line.table || claim.page !== page || !sameContext(claim.context, line.context)) return;
  if (claim.type === "printed_total") {
    const match = line.source.sourceText.match(new RegExp(`^Total:\\s*(\\$${numberBody})\\s*$`, "i"));
    if (!match || !tokenMatches(claim.amount, line.source, match[1], line.source.sourceText.indexOf(match[1]))) return;
    const value = normalizeNumber(match[1], true);
    if (value) return { type: claim.type, value, source: line.source, context: line.context, line };
  } else if (claim.type === "pallet_count") {
    // Counts must be whole source numbers; keep event meaning and matching offsets.
    const pattern = /(?<![\w.,+\-])([+-]?(?:\d{1,3}(?:,\d{3})+|\d+))\s+pallets?\s+(loaded|unloaded)\b/gi;
    const match = [...line.source.sourceText.matchAll(pattern)].find(m => m[2].toLowerCase() === claim.qualifier && tokenMatches(claim.count, line.source, m[1], m.index));
    if (!match) return;
    const value = normalizeNumber(match[1]);
    if (value) return { type: claim.type, value, qualifier: claim.qualifier, source: line.source, context: line.context, line };
  }
}
