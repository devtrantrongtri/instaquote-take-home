import type { ExtractionResult, ItemField, LineItem, Refusal, Scope } from "../contracts";
import type { PageExtractionResult, SourceQuote } from "../extraction/types";
import { businessIssues, evidence, type AcceptedRow } from "./business";
import { cellSource, lineFor, sameContext, sameQuote, sourceView, validateClaim, validatedNumber, type ValidClaim } from "./evidence";

/** Called within the service's per-page exception boundary. */
export function validatePage(parsed: PageExtractionResult, singlePageDocument = true): ExtractionResult {
  const result: ExtractionResult = { items: [], refusals: [], issues: [] };
  const page = parsed.reader.page;
  if (!Number.isInteger(page) || page < 1) throw new Error("Invalid reader page number.");
  const pageScope = { kind: "page" as const, page };
  if (parsed.reader.status === "no_usable_text") {
    result.refusals.push({ scope: pageScope, code: "no_usable_text",
      reason: "The current text reader could not reliably extract content from this page. Other readable pages can still be processed." });
    return result;
  }
  if (parsed.reader.status === "failed") {
    result.issues.push({ scope: pageScope, kind: "technical_error", code: "page_processing_failed",
      reason: "Text reading failed on this page. Results from other pages have been preserved." });
    return result;
  }
  if (parsed.diagnostics.some(d => d.code === "unsupported_geometry")) {
    result.refusals.push({ scope: pageScope, code: "unsupported_layout", reason: "The text orientation or layout on this page cannot be read reliably by the current reader." });
    return result;
  }
  const view = sourceView(parsed);
  const seenRefusals = new Set<string>();
  const refuse = (scope: Scope, code: Refusal["code"], reason: string, quote?: SourceQuote) => {
    const key = JSON.stringify([scope, code, reason]);
    if (seenRefusals.has(key)) return;
    seenRefusals.add(key);
    result.refusals.push({ scope, code, reason, ...(quote ? { evidence: [evidence(quote)] } : {}) });
  };
  const blockedRows = new Set<string>();
  const blockedFields = new Set<string>();
  const accounted = new Set<number>();
  // Only source-verified diagnostic quotes enter public evidence. Internal
  // messages are mapped to stable user-facing reasons, not exception dumps.
  for (const d of parsed.diagnostics) {
    const line = lineFor(view, d.source);
    const quote = line?.source;
    if (line) accounted.add(view.lines.indexOf(line));
    if (d.code === "unrecognized_cell" && d.rowId && (d.field === "item" || d.field === "description")) {
      blockedRows.add(d.rowId);
      refuse({ kind: "row", page, rowId: d.rowId }, "unreadable_row", "The item identity or description could not be read reliably.", quote);
      continue;
    }
    if (d.code === "unrecognized_cell" && d.rowId && d.field && d.field !== "item") {
      blockedFields.add(`${d.rowId}:${d.field}`);
      // Field evidence and the refusal are handled with the candidate below.
      if (parsed.candidates.some(c => c.id === d.rowId)) continue;
    }
    if (d.code === "unparsed_row") {
      if (d.rowId) blockedRows.add(d.rowId);
      const rowId = d.rowId ?? `p${page}-unparsed-${line ? view.lines.indexOf(line) : result.refusals.length}`;
      refuse({ kind: "row", page, rowId }, "unreadable_row", "A table row or wrapped continuation could not be mapped safely. It has not been accepted as a complete item.", quote);
    } else if (d.code === "unparsed_claim") {
      refuse(pageScope, "unsupported_field", "A printed total or pallet claim could not be read safely. No replacement value was inferred.", quote);
    } else {
      refuse(pageScope, "unsupported_layout", "Some table content on this page could not be identified or mapped reliably.", quote);
    }
  }
  if (!view.tables.length) refuse(pageScope, "unsupported_layout", "Some table content on this page could not be identified or mapped reliably.");
  const rows: AcceptedRow[] = [];
  const seenRows = new Set<number>();
  for (const candidate of parsed.candidates) {
    const line = lineFor(view, candidate.source);
    const lineIndex = line ? view.lines.indexOf(line) : -1;
    const rowId = `p${page}-l${lineIndex}`;
    const rowScope = { kind: "row" as const, page, rowId };
    if (line) accounted.add(lineIndex);
    if (blockedRows.has(candidate.id)) continue;
    const header = parsed.headers.find(h => h.id === candidate.headerId);
    if (!line || !line.rowLike || !line.table || candidate.page !== page || candidate.id !== rowId || seenRows.has(lineIndex)
      || !header || !sameQuote(header.source, line.table.line.source)
      || header.kind !== (line.table.columns.some(c => c.field === "weightRaw") ? "weight" : "standard")
      || JSON.stringify(header.columns) !== JSON.stringify(line.table.columns)
      || !sameContext(candidate.context, line.context)) {
      refuse(rowScope, "unreadable_row", "This item's source, table association or page context could not be verified.");
      continue;
    }
    seenRows.add(lineIndex);
    const itemSource = cellSource(line, "item"), description = cellSource(line, "description");
    if (!itemSource || !/^\d+$/.test(itemSource.sourceText.trim()) || !sameQuote(candidate.cells.item?.source, itemSource)
      || !description?.sourceText.trim() || !sameQuote(candidate.cells.description?.source, description)) {
      refuse(rowScope, "unreadable_row", "The item identity or description could not be verified against its source columns.", line.source);
      continue;
    }
    const item: LineItem = { id: rowId, description: description.sourceText.trim(),
      evidence: [evidence(line.source), evidence(line.table.line.source), ...line.context.map(evidence)] };
    if (line.context.length) item.context = line.context.map(q => q.sourceText).join("\n");
    const fields = line.table.columns.map(c => c.field);
    const names: Record<ItemField, string> = { description: "description", quantity: "quantity", unit: "quantity unit", unitPrice: "unit price", priceBasis: "price basis", lineTotal: "line total", weightRaw: "printed weight" };
    const fieldRefusal = (field: ItemField, quote?: SourceQuote) => refuse({ kind: "field", page, rowId, field }, "unsupported_field",
      `The ${names[field]} field could not be verified in its source column. It has been left out rather than inferred.`, quote);
    for (const field of ["quantity", "unitPrice", "lineTotal", "unit", "weightRaw"] as const) {
      const cell = candidate.cells[field];
      if (!fields.includes(field)) {
        if (cell !== undefined) fieldRefusal(field); // Reject a synthesized optional field.
        continue;
      }
      const expected = cellSource(line, field);
      if (!expected || !expected.sourceText.trim() || !sameQuote(cell?.source, expected) || blockedFields.has(`${candidate.id}:${field}`)) {
        fieldRefusal(field, expected?.sourceText ? expected : undefined);
        continue;
      }
      if (field === "unit" || field === "weightRaw") { item[field] = expected.sourceText; continue; }
      const value = validatedNumber(cell, expected, field !== "quantity", field === "unitPrice");
      if (!value) { fieldRefusal(field, expected); continue; }
      item[field] = value;
      if (field === "unitPrice" && cell?.priceBasis) item.priceBasis = cell.priceBasis;
    }
    rows.push({ item, line });
  }
  // Independently check row-like source lines: deleting a candidate must not
  // produce a smaller, apparently complete table or a false total mismatch.
  for (const [i, line] of view.lines.entries()) {
    if (line.rowLike && !accounted.has(i)) refuse({ kind: "row", page, rowId: `p${page}-l${i}` }, "unreadable_row",
      "A source table row was not accounted for by extraction. The table is incomplete.", line.source);
  }
  for (const table of view.tables) {
    if (!rows.some(r => r.line.table === table) && !result.refusals.length) refuse(pageScope, "unsupported_layout", "A table header was found, but its rows could not be extracted reliably.", table.line.source);
  }
  const claims: ValidClaim[] = [];
  let claimsComplete = !parsed.diagnostics.some(d => d.code === "unparsed_claim");
  const claimLines = new Set<number>();
  const claimKeys = new Set<string>();
  for (const claim of parsed.claims) {
    const valid = validateClaim(claim, view, page);
    const line = lineFor(view, claim.source);
    if (line) claimLines.add(view.lines.indexOf(line));
    if (!valid) {
      claimsComplete = false;
      refuse(pageScope, "unsupported_field", "A printed total or pallet claim failed source verification. It has not been used for consistency checks.", line?.source);
      continue;
    }
    const key = JSON.stringify([valid.type, valid.source.fragmentIndices, valid.qualifier, claim.type === "pallet_count" ? claim.count.start : claim.amount.start]);
    if (claimKeys.has(key)) {
      claimsComplete = false;
      refuse(pageScope, "unsupported_field", "A source claim was mapped more than once. Claim consistency could not be established.", valid.source);
      continue;
    }
    claimKeys.add(key);
    claims.push(valid);
  }
  for (const [i, line] of view.lines.entries()) {
    if (!line.table && /^(?:Total\s*:)|\bpallets?\s+(?:loaded|unloaded)\b/i.test(line.source.sourceText.trim())
      && !claimLines.has(i) && !accounted.has(i)) {
      claimsComplete = false;
      refuse(pageScope, "unsupported_field", "A printed total or pallet claim was not accounted for by extraction.", line.source);
    }
    const events = [...line.source.sourceText.matchAll(/\bpallets?\s+(?:loaded|unloaded)\b/gi)].length;
    if (!line.table && events > claims.filter(c => c.line === line && c.type === "pallet_count").length) {
      claimsComplete = false;
      refuse(pageScope, "unsupported_field", "Some pallet event claims could not be independently verified.", line.source);
    }
  }
  result.items = rows.map(r => r.item);
  result.issues.push(...businessIssues(page, rows, claims, view, result.refusals.length === 0 && singlePageDocument, claimsComplete));
  return result;
}
