import type { Evidence, Issue, LineItem, SourceNumber } from "../contracts";
import type { SourceQuote } from "../extraction/types";
import { sameContext, type CheckedLine, type SourceView, type ValidClaim } from "./evidence";

export const evidence = (q: SourceQuote): Evidence => ({ page: q.page, sourceText: q.sourceText });
export type AcceptedRow = { item: LineItem; line: CheckedLine };

/** Exact scaled integers; never Number/parseFloat/rounding for monetary equality. */
function scaled(value: string): { integer: bigint; scale: bigint } {
  const [whole, fraction = ""] = value.split(".");
  return { integer: BigInt(whole + fraction), scale: BigInt(10) ** BigInt(fraction.length) };
}
function cents(number: SourceNumber): bigint | undefined {
  const fraction = number.value.split(".")[1] ?? "";
  if (fraction.length > 2) return;
  const n = scaled(number.value);
  return n.integer * BigInt(100) / n.scale;
}

export function businessIssues(page: number, rows: AcceptedRow[], claims: ValidClaim[], view: SourceView, complete: boolean, claimsComplete: boolean): Issue[] {
  const issues: Issue[] = [];
  const scope = { kind: "page" as const, page };
  const ambiguousWeights = rows.filter(({ item }) => item.weightRaw && !/\btotal\b/i.test(item.weightRaw));
  if (ambiguousWeights.length) issues.push({ kind: "warning", code: "ambiguous_weight", scope,
    reason: "Some printed weights do not say whether they apply per unit or to the whole row. They are shown exactly as written, without assigning a weight meaning.",
    evidence: ambiguousWeights.flatMap(r => r.item.evidence.slice(0, 2)) });

  // Compare only paired events in the same page/context. Multiple claims or
  // unrelated contexts are not collapsed into a single business count.
  const pallets = claims.filter(c => c.type === "pallet_count");
  const groups: ValidClaim[][] = [];
  for (const claim of pallets) {
    const group = groups.find(g => sameContext(g[0].context, claim.context));
    if (group) group.push(claim); else groups.push([claim]);
  }
  for (const group of groups) {
    const loaded = group.filter(c => c.qualifier === "loaded"), unloaded = group.filter(c => c.qualifier === "unloaded");
    if (claimsComplete && loaded.length === 1 && unloaded.length === 1) {
      if (BigInt(loaded[0].value.value) !== BigInt(unloaded[0].value.value)) issues.push({ kind: "warning", code: "pallet_discrepancy", scope,
        reason: "The document reports different pallet counts at loading and unloading. Both event-specific claims are preserved; a single pallet count cannot safely be resolved.",
        evidence: group.map(c => evidence(c.source)) });
    } else if (group.length) issues.push({ kind: "warning", code: "consistency_not_checked", scope,
      reason: "The pallet claims could not be paired unambiguously within this page and context. No single pallet count was inferred.", evidence: group.map(c => evidence(c.source)) });
  }

  for (const { item } of rows) {
    if (!item.lineTotal) continue;
    const rowScope = { kind: "row" as const, page, rowId: item.id };
    const price = item.unitPrice && cents(item.unitPrice), total = cents(item.lineTotal);
    const basisMatches = !item.priceBasis || item.priceBasis.slice(1).toLowerCase() === item.unit?.toLowerCase();
    if (!item.quantity || !item.unit || price === undefined || total === undefined || !basisMatches) {
      issues.push({ kind: "warning", code: "consistency_not_checked", scope: rowScope,
        reason: "This printed line total could not be checked because a required value, unit relationship or supported monetary precision is unavailable.", evidence: item.evidence });
      continue;
    }
    const q = scaled(item.quantity.value);
    if (q.integer * price !== total * q.scale) issues.push({ kind: "warning", code: "total_mismatch", scope: rowScope,
      reason: "The printed line total does not match the printed quantity and unit price. Source values have not been changed.", evidence: item.evidence });
  }

  const totals = claims.filter(c => c.type === "printed_total");
  for (const total of totals) {
    const monetary = cents(total.value);
    const header = view.tables[0];
    const eligible = complete && totals.length === 1 && view.tables.length === 1 && rows.length > 0 && monetary !== undefined
      && rows.every(r => r.line.table === header && r.line.y > total.line.y && sameContext(r.line.context, total.context)
        && r.item.lineTotal && cents(r.item.lineTotal) !== undefined);
    const supporting = [evidence(total.source), ...rows.flatMap(r => r.item.evidence.slice(0, 2))];
    if (!eligible) {
      issues.push({ kind: "warning", code: "consistency_not_checked", scope,
        reason: "The printed total was preserved, but could not be reconciled: complete line totals within a single-page document and an unambiguous table scope are required.", evidence: supporting });
      continue;
    }
    const sum = rows.reduce((value, row) => value + cents(row.item.lineTotal!)!, BigInt(0));
    if (sum !== monetary) issues.push({ kind: "warning", code: "total_mismatch", scope,
      reason: "The printed total does not match the printed line totals. No source value was changed and no explanation for the difference was inferred.", evidence: supporting });
  }
  return issues;
}
