import type { PdfPageResult } from "../pdf/read-pages";
import type {
  CandidateCell, CandidateNumericField, Column, PageExtractionResult,
  SourceFragment, SourceQuote, TableHeader,
} from "./types";

const layouts: { kind: TableHeader["kind"]; labels: string[]; fields: Column[] }[] = [
  { kind: "standard", labels: ["item", "description", "qty", "unit", "unit price", "line total"],
    fields: ["item", "description", "quantity", "unit", "unitPrice", "lineTotal"] },
  { kind: "weight", labels: ["item", "description", "qty", "weight", "unit price"],
    fields: ["item", "description", "quantity", "weightRaw", "unitPrice"] },
];
const decimal = String.raw`[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const quantityPattern = new RegExp(`^\\s*(${decimal})\\s*$`);
const pricePattern = new RegExp(`^\\s*(\\$${decimal})(?:\\s+(\\/[^\\s]+))?\\s*$`);
const totalPattern = new RegExp(`^Total:\\s*(\\$${decimal})\\s*$`, "i");
const palletPattern = new RegExp(`(?<![\\w.,+\\-])(${decimal})\\s+pallets?\\s+(unloaded|loaded)\\b`, "gi");
const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const x = (f: SourceFragment) => f.transform[4];
const y = (f: SourceFragment) => f.transform[5];

/** Preserve strings before interpretation. Geometry supplies only missing spaces. */
function quote(page: number, fragments: readonly SourceFragment[]): SourceQuote {
  let sourceText = "";
  for (const f of fragments) {
    if (sourceText && f.str && !/\s$/.test(sourceText) && !/^\s/.test(f.str)) sourceText += " ";
    sourceText += f.str;
  }
  return { page, sourceText, fragmentIndices: fragments.map(f => f.index) };
}
function numeric(source: SourceQuote, raw: string): CandidateNumericField {
  const start = source.sourceText.indexOf(raw);
  return { raw, start, end: start + raw.length, source };
}
function isContext(text: string): boolean {
  return /^(?:Multi-Site\b|Site\s+\d|Summary\s*-|Returns Note\b|Credit Adjustment\b|Signed Acceptance\b|Packing List\b|Invoice\b|Delivery (?:Docket|Note)\b|Delivered to:)/i.test(text.trim());
}
function isBoundary(text: string): boolean {
  return /^(?:Total\b|Note:|Driver notes:|Summary:|Freight\b|Page\s+\d+\s+of\s+\d+)/i.test(text.trim()) || isContext(text);
}

/** Bounded horizontal-table parser. Output is untrusted input to Task 4. */
export function parsePage(reader: PdfPageResult): PageExtractionResult {
  const ledger = Object.freeze(reader.status === "failed" ? [] : reader.fragments.map(f =>
    Object.freeze({ ...f, transform: Object.freeze([...f.transform]) })));
  const result: PageExtractionResult = {
    reader, ledger, lines: [], headers: [], context: [], candidates: [], claims: [], diagnostics: [],
  };
  if (reader.status !== "text") return result;
  const meaningful = ledger.filter(f => f.str.trim());
  if (meaningful.some(f => f.transform.length !== 6 || !f.transform.every(Number.isFinite)
    || f.dir !== "ltr" || Math.abs(f.transform[1]) > 0.01 || Math.abs(f.transform[2]) > 0.01
    || f.transform[0] <= 0 || f.transform[3] <= 0 || !Number.isFinite(f.width) || f.width < 0)) {
    result.diagnostics.push({ code: "unsupported_geometry", reason: "Only horizontal left-to-right text is supported.", source: quote(reader.page, ledger) });
    return result;
  }
  // Baseline tolerance is small relative to font height; never merge adjacent rows.
  const groups: SourceFragment[][] = [];
  for (const f of [...ledger].filter(f => f.str).sort((a, b) => y(b) - y(a) || x(a) - x(b))) {
    const group = groups.find(g => Math.abs(y(g[0]) - y(f)) <= Math.max(0.5, Math.min(g[0].height, f.height) * 0.2));
    if (group) group.push(f); else groups.push([f]);
  }
  const lineFragments = groups.map(g => g.sort((a, b) => x(a) - x(b) || a.index - b.index));
  result.lines = lineFragments.map((g, i) => ({ ...quote(reader.page, g), id: `p${reader.page}-l${i}`, y: y(g[0]) }));
  let active: TableHeader | undefined;
  let lastRowId: string | undefined;
  let context: SourceQuote[] = [];
  for (const [index, line] of result.lines.entries()) {
    const fragments = lineFragments[index].filter(f => f.str.trim());
    const text = line.sourceText.trim();
    if (!text || /^[-_]+$/.test(text)) continue;
    if (isContext(text)) {
      context = /^Delivered to:/i.test(text) ? [...context, line] : [line];
      result.context.push(line);
    }
    // Claims are outside table rows; a numeric phrase in a description is not a document claim.
    if (!active || isBoundary(text)) {
      const total = line.sourceText.match(totalPattern);
      if (total) result.claims.push({ type: "printed_total", page: reader.page, source: line, context: [...context], amount: numeric(line, total[1]) });
      else if (/^Total\s*:/i.test(text)) result.diagnostics.push({ code: "unparsed_claim", reason: "Printed total token is outside the supported grammar.", source: line });
      for (const match of line.sourceText.matchAll(palletPattern)) {
        // Match-specific offset matters if a sentence contains repeated counts.
        const start = match.index;
        result.claims.push({ type: "pallet_count", page: reader.page, source: line, context: [...context],
          qualifier: match[2].toLowerCase() as "loaded" | "unloaded",
          count: { raw: match[1], start, end: start + match[1].length, source: line } });
      }
      if ([...text.matchAll(/pallets?\s+(?:unloaded|loaded)\b/gi)].length > [...line.sourceText.matchAll(palletPattern)].length) {
        result.diagnostics.push({ code: "unparsed_claim", reason: "Pallet claim has no supported count token.", source: line });
      }
    }
    const labels = fragments.map(f => normalize(f.str));
    const layout = layouts.find(l => l.labels.length === labels.length && l.labels.every((v, i) => v === labels[i]));
    if (layout) {
      active = { id: line.id, kind: layout.kind, source: line,
        columns: layout.fields.map((field, i) => ({ field, x: x(fragments[i]) })) };
      result.headers.push(active);
      lastRowId = undefined;
      continue;
    }
    if (/\bDescription\b/i.test(text) && /\bQty\b/i.test(text)) {
      result.diagnostics.push({ code: "unsupported_header", reason: "Table header cannot be mapped unambiguously to supported columns.", source: line });
      active = undefined;
      continue;
    }
    if (isBoundary(text)) { active = undefined; lastRowId = undefined; continue; }
    if (!active) continue;
    const firstX = x(fragments[0]);
    const descX = active.columns[1].x;
    const qtyX = active.columns[2].x;
    const indexed = firstX < descX - 2 && /^\d+\b/.test(text);
    const columnContent = fragments.some(f => x(f) >= qtyX - 2);
    // A nearby description-only line may be wrapping. Do not append or silently
    // accept its preceding row; diagnostics link that row for later validation.
    const possibleWrap = lastRowId && firstX >= descX - 2 && firstX < qtyX - 2;
    if (!indexed && !columnContent && !possibleWrap) continue;
    const cells: Partial<Record<Column, CandidateCell>> = {};
    let ambiguous = false;
    for (const [i, col] of active.columns.entries()) {
      const right = active.columns[i + 1]?.x ?? Infinity;
      const parts = fragments.filter(f => x(f) >= col.x - 2 && x(f) < right - 2);
      if (parts.some((f, j) => x(f) + f.width > right - 2
        || (j > 0 && x(parts[j - 1]) + parts[j - 1].width > x(f) + 0.5))) ambiguous = true;
      cells[col.field] = { source: quote(reader.page, parts) };
    }
    if (ambiguous || !/^\d+$/.test(cells.item?.source.sourceText.trim() ?? "") || !cells.description?.source.sourceText.trim()) {
      result.diagnostics.push({ code: "unparsed_row", reason: "Row identity, wrapping or column boundaries are ambiguous.", source: line,
        ...(possibleWrap && lastRowId ? { rowId: lastRowId } : {}) });
      continue;
    }
    const row = { id: line.id, page: reader.page, headerId: active.id, source: line, cells, context: [...context] };
    result.candidates.push(row);
    lastRowId = row.id;
    for (const field of ["quantity", "unitPrice", "lineTotal"] as const) {
      const cell = cells[field];
      if (!cell || !cell.source.sourceText.trim()) continue;
      const match = cell.source.sourceText.match(field === "quantity" ? quantityPattern : pricePattern);
      if (match && !(field === "lineTotal" && match[2])) {
        cell.numeric = numeric(cell.source, match[1]);
        if (match[2]) cell.priceBasis = match[2];
      } else result.diagnostics.push({ code: "unrecognized_cell", reason: "Cell retained raw; numeric token is outside the supported grammar.", source: cell.source, rowId: row.id, field });
    }
  }
  for (const header of result.headers) {
    if (!result.candidates.some(c => c.headerId === header.id)) result.diagnostics.push({ code: "empty_table", reason: "Supported header found but no safely mapped rows; content may be unavailable or unsupported.", source: header.source });
  }
  if (!result.headers.length) result.diagnostics.push({ code: "no_supported_table", reason: "No supported table was identified in the extracted text.", source: quote(reader.page, ledger) });
  return result;
}
