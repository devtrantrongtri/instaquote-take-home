import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractDocument, extractReadDocument } from "../lib/extract-document";
import { parsePage } from "../lib/extraction/parse-page";
import { PdfDocumentReadError, readPdfPages, type PdfPageResult, type PdfTextFragment } from "../lib/pdf/read-pages";
import { validatePage } from "../lib/validation/validate-page";
import type { PageExtractionResult } from "../lib/extraction/types";

async function readSample(name: string) { return readPdfPages(await readFile(`data/${name}.pdf`)); }
async function candidates(name = "KBS-10234") { return parsePage((await readSample(name)).pages[0]); }
async function extractSample(name: string) { return extractDocument(await readFile(`data/${name}.pdf`)); }

test("clean source-backed sample is accepted without refusals/issues or debug fields", async () => {
  const result = await extractSample("KBS-10234");
  assert.deepEqual(Object.keys(result).sort(), ["issues", "items", "refusals"]);
  assert.equal(result.items.length, 5); assert.deepEqual(result.refusals, []); assert.deepEqual(result.issues, []);
  assert.deepEqual(result.items.map(i => i.quantity?.value), ["48", "12", "36", "20", "8"]);
  assert.deepEqual(result.items[0].lineTotal, { raw: "$1,195.20", value: "1195.20" });
  for (const item of result.items) {
    assert.ok(item.evidence.length >= 2); assert.equal(item.evidence[0].page, 1);
    for (const field of ["quantity", "unitPrice", "lineTotal"] as const) assert.ok(item.evidence[0].sourceText.includes(item[field]!.raw));
    assert.equal("cells" in item, false); assert.equal("headerId" in item, false);
  }
});

for (const corruption of ["value", "offset", "quote", "fragment", "missing", "page"] as const) {
  test(`numeric evidence corruption (${corruption}) omits only the affected field`, async () => {
    const parsed = await candidates();
    const cell = parsed.candidates[0].cells.quantity!;
    // Break a candidate while keeping the independent source ledger intact.
    if (corruption === "value") cell.numeric!.raw = "999";
    if (corruption === "offset") cell.numeric!.start++;
    if (corruption === "quote") cell.source.sourceText = "999";
    if (corruption === "fragment") cell.source.fragmentIndices = [999999];
    if (corruption === "missing") delete cell.numeric;
    if (corruption === "page") cell.source.page = 2;
    const result = validatePage(parsed);
    assert.equal(result.items.length, 5); assert.equal(result.items[0].quantity, undefined);
    assert.equal(result.items[0].unitPrice?.value, "24.90");
    assert.ok(result.refusals.some(r => r.scope.kind === "field" && r.scope.field === "quantity"));
    assert.ok(result.issues.some(i => i.code === "consistency_not_checked"));
    assert.equal(result.issues.some(i => i.code === "total_mismatch"), false);
    assert.equal(JSON.stringify(result).includes("999"), false);
  });
}

test("a description number cannot validate Qty even with a real quote and offsets", async () => {
  const parsed = await candidates();
  const description = parsed.candidates[0].cells.description!.source;
  parsed.candidates[0].cells.quantity = { source: description, numeric: { raw: "10", start: 0, end: 2, source: description } };
  const result = validatePage(parsed);
  assert.equal(result.items[0].quantity, undefined);
  assert.match(result.items[0].description, /10mm/);
  assert.ok(result.refusals.some(r => r.scope.kind === "field" && r.scope.field === "quantity"));
});

test("forged header mapping and removed context cannot be used to accept rows", async () => {
  const parsed = await candidates();
  parsed.headers[0].columns[2].x = parsed.headers[0].columns[1].x;
  let result = validatePage(parsed);
  assert.equal(result.items.length, 0); assert.ok(result.refusals.length);
  const contextual = await candidates(); contextual.candidates[0].context = [];
  result = validatePage(contextual);
  assert.equal(result.items.length, 4); assert.ok(result.refusals.some(r => r.code === "unreadable_row"));
});

test("weight layout: optional totals absent, raw weights retained, only ambiguous weights warned", async () => {
  const result = await extractSample("KBS-10255");
  assert.equal(result.items.length, 4); assert.deepEqual(result.refusals, []);
  assert.deepEqual(result.items.map(i => i.weightRaw), ["25kg", "480g total", "1.2kg", "650g"]);
  assert.deepEqual(result.items.map(i => i.priceBasis), ["/bag", "/ea", "/ea", "/bundle"]);
  for (const item of result.items) { assert.equal("lineTotal" in item, false); assert.equal("unit" in item, false); assert.equal("totalWeight" in item, false); }
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, "ambiguous_weight");
  const quotes = result.issues[0].evidence!.map(e => e.sourceText).join("\n");
  assert.match(quotes, /25kg/); assert.match(quotes, /1.2kg/); assert.match(quotes, /650g/); assert.doesNotMatch(quotes, /480g total/);
});

test("a synthesized total is rejected even if another column contains the same amount", async () => {
  const parsed = await candidates("KBS-10255");
  parsed.candidates[0].cells.lineTotal = parsed.candidates[0].cells.unitPrice!;
  const result = validatePage(parsed);
  assert.equal(result.items.length, 4); assert.equal(result.items[0].lineTotal, undefined);
  assert.equal(result.refusals.length, 1);
  assert.ok(result.refusals[0].scope.kind === "field" && result.refusals[0].scope.field === "lineTotal");
});

test("different loading/unloading claims create one discrepancy with both quotes", async () => {
  const result = await extractSample("KBS-10262");
  assert.equal(result.items.length, 3); assert.deepEqual(result.refusals, []);
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, "pallet_discrepancy");
  assert.equal(result.issues[0].evidence!.length, 2);
  assert.match(result.issues[0].evidence![0].sourceText, /14 pallets loaded/);
  assert.match(result.issues[0].evidence![1].sourceText, /16 pallets unloaded/);
  assert.equal("palletCount" in result, false);
});

test("corrupt pallet claim is not used to manufacture a discrepancy", async () => {
  const parsed = await candidates("KBS-10262");
  const claim = parsed.claims.find(c => c.type === "pallet_count")!;
  if (claim.type === "pallet_count") claim.count.raw = "999";
  const result = validatePage(parsed);
  assert.equal(result.items.length, 3);
  assert.ok(result.refusals.some(r => r.code === "unsupported_field"));
  assert.equal(result.issues.some(i => i.code === "pallet_discrepancy"), false);
});

test("printed total mismatch preserves source values without a calculated total or freight", async () => {
  const parsed = await candidates("KBS-10270"); const before = JSON.stringify(parsed);
  const result = validatePage(parsed);
  assert.equal(JSON.stringify(parsed), before);
  assert.equal(result.items.length, 4); assert.deepEqual(result.refusals, []);
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, "total_mismatch");
  assert.match(result.issues[0].evidence![0].sourceText, /\$1,612\.90/);
  assert.deepEqual(result.items.map(i => i.lineTotal?.raw), ["$936.00", "$160.20", "$64.00", "$378.00"]);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /1538\.20|1,538\.20|74\.70/);
});

test("missing row coverage suppresses sum comparison, while useful rows remain", async () => {
  const parsed = await candidates("KBS-10270"); parsed.candidates.pop();
  const result = validatePage(parsed);
  assert.equal(result.items.length, 3);
  assert.ok(result.refusals.some(r => r.code === "unreadable_row"));
  assert.ok(result.issues.some(i => i.code === "consistency_not_checked"));
  assert.equal(result.issues.some(i => i.code === "total_mismatch"), false);
});

test("no text is a page-scoped refusal, never proof of a blank page", async () => {
  const result = await extractSample("KBS-10241");
  assert.deepEqual(result.items, []); assert.deepEqual(result.issues, []);
  assert.equal(result.refusals.length, 1); assert.equal(result.refusals[0].code, "no_usable_text");
  assert.deepEqual(result.refusals[0].scope, { kind: "page", page: 1 });
  assert.doesNotMatch(result.refusals[0].reason, /blank|scanned|no items/i);
});

test("DR118 keeps original pages, all repeated rows and positive Returns/Credit values", async () => {
  const result = await extractSample("KBS-DR118");
  assert.equal(result.items.length, 21); assert.equal(new Set(result.items.map(i => i.id)).size, 21);
  assert.deepEqual([...new Set(result.items.map(i => i.evidence[0].page))], [1, 2, 3, 5, 6, 7, 8]);
  assert.equal(result.refusals.length, 1); assert.deepEqual(result.refusals[0].scope, { kind: "page", page: 4 });
  assert.deepEqual(result.issues, []);
  for (const [page, context] of [[5, "Summary"], [6, "Returns Note"], [7, "Credit Adjustment"], [8, "Signed Acceptance"]] as const) {
    const rows = result.items.filter(i => i.evidence[0].page === page);
    assert.equal(rows.length, 3); assert.deepEqual(rows.map(i => i.quantity!.value), ["10", "13", "16"]);
    assert.ok(rows.every(i => i.context!.includes(context)));
    assert.deepEqual(rows.map(i => i.lineTotal!.value), ["160.00", "221.00", "288.00"]);
  }
});

function synthetic(rows: string[][], trailing: string[] = []): PdfPageResult {
  const xs = [20, 70, 300, 355, 420, 510];
  const lines = [["Item", "Description", "Qty", "Unit", "Unit Price", "Line Total"], ...rows, ...trailing.map(s => [s])];
  const fragments: PdfTextFragment[] = lines.flatMap((cells, row) => cells.map((str, col) => ({
    index: row * 6 + col, str, dir: "ltr", transform: [10, 0, 0, 10, xs[col], 700 - row * 20],
    width: str.length * 4, height: 10, fontName: "test", hasEOL: col === cells.length - 1,
  })));
  return { page: 1, status: "text", text: "not used for evidence", fragments };
}

test("present blank/unrecognized numeric cells produce scoped refusals", () => {
  const parsed = parsePage(synthetic([["1", "Board", "??", "sheet", "$2.30", ""]]));
  const result = validatePage(parsed);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].unitPrice?.value, "2.30");
  assert.equal(result.items[0].quantity, undefined); assert.equal(result.items[0].lineTotal, undefined);
  assert.deepEqual(result.refusals.map(r => r.scope.kind === "field" && r.scope.field).sort(), ["lineTotal", "quantity"]);
});

test("unresolved wrapped-row diagnostic blocks affected item, preserves independent row", () => {
  const reader = synthetic([["1", "Board", "7", "sheet", "$2.30", "$16.10"], ["2", "Panel", "8", "sheet", "$2.30", "$18.40"]]);
  if (reader.status === "failed") return;
  reader.fragments.push({ ...reader.fragments[7], index: 99, str: "continued description", transform: [10, 0, 0, 10, 70, 670] });
  const result = validatePage(parsePage(reader));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].description, "Panel");
  assert.ok(result.refusals.some(r => r.code === "unreadable_row"));
});

test("decimal-safe arithmetic avoids float artifacts and does not round unsupported precision", () => {
  let result = validatePage(parsePage(synthetic([["1", "Board", "3", "sheet", "$0.10", "$0.30"]], ["Total: $0.30"])));
  assert.deepEqual(result.refusals, []); assert.deepEqual(result.issues, []);
  result = validatePage(parsePage(synthetic([["1", "Board", "0.5", "sheet", "$0.20", "$0.10"]], ["Total: $0.10"])));
  assert.deepEqual(result.issues, []);
  result = validatePage(parsePage(synthetic([["1", "Board", "3", "sheet", "$0.101", "$0.303"]], ["Total: $0.303"])));
  assert.equal(result.items[0].lineTotal!.raw, "$0.303");
  assert.ok(result.issues.every(i => i.code === "consistency_not_checked")); assert.ok(result.issues.length);
});

test("row mismatch warns without rewriting values; explicit negative source signs survive", () => {
  const result = validatePage(parsePage(synthetic([["1", "Board", "-3", "sheet", "$0.10", "$-0.20"]])));
  assert.equal(result.items[0].quantity!.value, "-3"); assert.equal(result.items[0].lineTotal!.value, "-0.20");
  assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, "total_mismatch");
  assert.equal(result.issues[0].scope.kind, "row");
});

test("equal pallet event counts do not create a discrepancy", () => {
  const reader = synthetic([["1", "Board", "3", "sheet", "$0.10", "$0.30"]], ["Summary: 2 pallets loaded", "Driver notes: 2 pallets unloaded"]);
  const result = validatePage(parsePage(reader)); assert.deepEqual(result.issues, []);
});

test("reader failure and parser exception are local technical issues; internal error text stays private", async () => {
  const doc = await readSample("KBS-DR118");
  doc.pages[3] = { page: 4, status: "failed", error: { code: "page_read_failed", message: "private stack path" } };
  for (const result of [extractReadDocument(doc), extractReadDocument(doc, page => {
    if (page.page === 4) throw new Error("private stack path"); return parsePage(page);
  })]) {
    assert.equal(result.items.length, 21); assert.deepEqual(result.refusals, []);
    assert.equal(result.issues.length, 1); assert.equal(result.issues[0].code, "page_processing_failed");
    assert.deepEqual(result.issues[0].scope, { kind: "page", page: 4 });
    assert.equal(JSON.stringify(result).includes("private stack"), false);
  }
});

test("malformed candidate state becomes page-local validation failure, not false missing source", async () => {
  const doc = await readSample("KBS-DR118");
  const result = extractReadDocument(doc, page => {
    const p = parsePage(page);
    if (page.page === 2) p.candidates = null as unknown as PageExtractionResult["candidates"];
    return p;
  });
  assert.equal(result.items.length, 18);
  assert.ok(result.issues.some(i => i.code === "page_processing_failed" && i.scope.kind === "page" && i.scope.page === 2));
  assert.equal(result.refusals.length, 1); assert.deepEqual(result.refusals[0].scope, { kind: "page", page: 4 });
});

test("fatal document opening errors remain outside ExtractionResult", async () => {
  await assert.rejects(extractDocument(new Uint8Array()), e => e instanceof PdfDocumentReadError && e.code === "unreadable_pdf");
});

test("corrupt printed total evidence is refused rather than compared or published", async () => {
  const parsed = await candidates("KBS-10270");
  const claim = parsed.claims.find(c => c.type === "printed_total")!;
  if (claim.type === "printed_total") claim.amount.raw = "$999.99";
  const result = validatePage(parsed);
  assert.equal(result.items.length, 4); assert.ok(result.refusals.some(r => r.code === "unsupported_field"));
  assert.equal(result.issues.some(i => i.code === "total_mismatch"), false);
  assert.doesNotMatch(JSON.stringify(result), /999\.99/);
});

test("dropping one event on a shared source line cannot hide incomplete claim coverage", () => {
  const parsed = parsePage(synthetic([["1", "Board", "3", "sheet", "$0.10", "$0.30"]], ["Summary: 2 pallets loaded; 3 pallets unloaded"]));
  assert.equal(parsed.claims.length, 2); parsed.claims.pop();
  const result = validatePage(parsed);
  assert.ok(result.refusals.some(r => r.code === "unsupported_field"));
  assert.equal(result.issues.some(i => i.code === "pallet_discrepancy"), false);
  assert.ok(result.issues.some(i => i.code === "consistency_not_checked"));
});

test("page subtotals are not assumed to be document totals in a multi-page document", () => {
  const first = synthetic([["1", "Board", "3", "sheet", "$0.10", "$0.30"]], ["Total: $0.30"]);
  const second = { ...structuredClone(first), page: 2 };
  const result = extractReadDocument({ pageCount: 2, pages: [first, second] });
  assert.equal(result.items.length, 2); assert.deepEqual(result.refusals, []);
  assert.equal(result.issues.length, 2); assert.ok(result.issues.every(i => i.code === "consistency_not_checked"));
});

test("altered source ledger is rejected at the page boundary without losing other pages", async () => {
  const document = await readSample("KBS-DR118");
  const result = extractReadDocument(document, page => {
    const p = parsePage(page);
    if (page.page === 2) p.ledger = p.ledger.map((f, i) => i === 0 ? { ...f, str: "fabricated source" } : f);
    return p;
  });
  assert.equal(result.items.length, 18);
  assert.ok(result.issues.some(i => i.code === "page_processing_failed" && i.scope.kind === "page" && i.scope.page === 2));
  assert.doesNotMatch(JSON.stringify(result), /fabricated source/);
});

test("a diagnostic on required description blocks the row even when its text is present", async () => {
  const parsed = await candidates();
  const row = parsed.candidates[0];
  parsed.diagnostics.push({ code: "unrecognized_cell", reason: "test", source: row.cells.description!.source, rowId: row.id, field: "description" });
  const result = validatePage(parsed);
  assert.equal(result.items.length, 4);
  assert.ok(result.refusals.some(r => r.code === "unreadable_row" && r.scope.kind === "row" && r.scope.rowId === row.id));
});
