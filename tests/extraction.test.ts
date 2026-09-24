import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readPdfPages, type PdfPageResult, type PdfTextFragment } from "../lib/pdf/read-pages";
import { parsePage } from "../lib/extraction/parse-page";
import type { PageExtractionResult, SourceQuote } from "../lib/extraction/types";

async function sample(name: string) {
  return (await readPdfPages(await readFile(`data/${name}.pdf`))).pages.map(parsePage);
}
function checkQuote(q: SourceQuote, p: PageExtractionResult) {
  assert.equal(q.page, p.reader.page);
  for (const id of q.fragmentIndices) {
    const fragment = p.ledger.find(f => f.index === id);
    assert.ok(fragment);
    assert.ok(q.sourceText.includes(fragment.str));
  }
}
test("standard table: column mapping keeps description dimensions out of Qty, with source evidence", async () => {
  const [p] = await sample("KBS-10234");
  assert.equal(p.candidates.length, 5);
  assert.deepEqual(p.candidates.map(c => c.cells.quantity?.numeric?.raw), ["48", "12", "36", "20", "8"]);
  assert.match(p.candidates[0].cells.description!.source.sourceText, /10mm.*2400x1200/);
  assert.deepEqual(p.candidates.map(c => c.cells.lineTotal?.numeric?.raw), ["$1,195.20", "$462.00", "$352.80", "$284.00", "$336.00"]);
  assert.deepEqual(p.diagnostics, []);
  for (const row of p.candidates) {
    checkQuote(row.source, p);
    assert.ok(p.headers.some(h => h.id === row.headerId));
    for (const cell of Object.values(row.cells)) {
      checkQuote(cell.source, p);
      if (cell.numeric) assert.equal(cell.source.sourceText.slice(cell.numeric.start, cell.numeric.end), cell.numeric.raw);
    }
  }
});
test("weight layout retains literal weight and price basis without line totals or quantity units", async () => {
  const [p] = await sample("KBS-10255");
  assert.equal(p.candidates.length, 4);
  assert.deepEqual(p.candidates.map(c => c.cells.weightRaw?.source.sourceText), ["25kg", "480g total", "1.2kg", "650g"]);
  assert.deepEqual(p.candidates.map(c => c.cells.unitPrice?.priceBasis), ["/bag", "/ea", "/ea", "/bundle"]);
  assert.deepEqual(p.candidates.map(c => c.cells.quantity?.numeric?.raw), ["4", "1200", "6", "3"]);
  for (const c of p.candidates) { assert.equal("lineTotal" in c.cells, false); assert.equal("unit" in c.cells, false); }
  assert.deepEqual(p.claims, []);
  assert.deepEqual(p.diagnostics, []);
});
test("loaded/unloaded are independent raw claims, no discrepancy decision", async () => {
  const [p] = await sample("KBS-10262");
  assert.equal(p.candidates.length, 3);
  const claims = p.claims.filter(c => c.type === "pallet_count");
  assert.deepEqual(claims.map(c => [c.count.raw, c.qualifier]), [["14", "loaded"], ["16", "unloaded"]]);
  for (const c of claims) { checkQuote(c.source, p); assert.equal(c.source.sourceText.slice(c.count.start, c.count.end), c.count.raw); }
  assert.deepEqual(p.diagnostics, []);
  assert.equal("issues" in p, false);
});
test("printed total remains its source token without a calculated replacement", async () => {
  const [p] = await sample("KBS-10270");
  assert.equal(p.candidates.length, 4);
  assert.equal(p.claims.length, 1);
  assert.equal(p.claims[0].type, "printed_total");
  if (p.claims[0].type === "printed_total") assert.equal(p.claims[0].amount.raw, "$1,612.90");
  assert.deepEqual(p.diagnostics, []);
});
test("image page state survives with no fabricated candidates", async () => {
  const [p] = await sample("KBS-10241");
  assert.equal(p.reader.status, "no_usable_text");
  assert.deepEqual(p.candidates, []); assert.deepEqual(p.claims, []);
});
test("mixed document preserves all pages, repeated row occurrences, signs and contextual headings", async () => {
  const pages = await sample("KBS-DR118");
  assert.deepEqual(pages.map(p => p.reader.page), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(pages[3].reader.status, "no_usable_text");
  assert.equal(pages[3].candidates.length, 0);
  const rows = pages.flatMap(p => p.candidates);
  assert.equal(rows.length, 21); assert.equal(new Set(rows.map(r => r.id)).size, 21);
  for (const p of pages.filter(p => p.reader.status === "text")) {
    assert.deepEqual(p.candidates.map(c => c.cells.quantity?.numeric?.raw), ["10", "13", "16"]);
    for (const c of p.candidates) { assert.equal(c.page, p.reader.page); assert.equal(c.context.length, 1); checkQuote(c.context[0], p); }
    assert.deepEqual(p.diagnostics, []);
  }
  for (const [page, heading] of [[5, "Summary"], [6, "Returns Note"], [7, "Credit Adjustment"], [8, "Signed Acceptance"]] as const) {
    assert.ok(pages[page - 1].candidates.every(c => c.context[0].sourceText.includes(heading)));
  }
});

function fixture(rows: string[][] = [["1", "10mm board 2400x1200", "7", "sheet", "$2.30", "$16.10"]]): PdfPageResult {
  const all = [["Item", "Description", "Qty", "Unit", "Unit Price", "Line Total"], ...rows];
  const positions = [20, 70, 300, 355, 420, 510];
  const fragments: PdfTextFragment[] = all.flatMap((cells, row) => cells.map((str, col) => ({
    index: row * 6 + col, str, dir: "ltr", transform: [10, 0, 0, 10, positions[col], 700 - row * 20],
    width: str.length * 4, height: 10, fontName: "test", hasEOL: col === 5,
  })));
  return { page: 9, status: "text", text: "deliberately unused", fragments };
}
test("header-relative geometry works after translation, scaling and content-stream reordering", () => {
  const p = fixture(); assert.notEqual(p.status, "failed"); if (p.status === "failed") return;
  for (const f of p.fragments) { f.transform[4] = f.transform[4] * 1.3 + 37; f.transform[5] *= 1.3; f.width *= 1.3; }
  p.fragments.reverse();
  const output = parsePage(p);
  assert.equal(output.candidates[0].cells.quantity?.numeric?.raw, "7");
  assert.deepEqual(output.diagnostics, []);
  assert.ok(Object.isFrozen(output.ledger));
  const original = output.ledger[0].str;
  p.fragments[0].str = "changed";
  assert.equal(output.ledger[0].str, original);
});
test("blank and unrecognized present cells remain distinct from absent columns", () => {
  const p = parsePage(fixture([["1", "Board", "??", "sheet", "$2.30", ""]]));
  assert.equal(p.candidates.length, 1);
  const c = p.candidates[0];
  assert.equal(c.cells.lineTotal?.source.sourceText, "");
  assert.equal(c.cells.quantity?.source.sourceText, "??");
  assert.equal(c.cells.quantity?.numeric, undefined);
  assert.equal(c.cells.weightRaw, undefined);
  assert.ok(p.diagnostics.some(d => d.field === "quantity" && d.rowId === c.id));
});
test("overlapping column content is visible and independent rows survive", () => {
  const p = fixture([["1", "Board", "7", "sheet", "$2.30", "$16.10"], ["2", "Board", "8", "sheet", "$2.30", "$18.40"]]);
  if (p.status === "failed") return;
  p.fragments[7].width = 300;
  const output = parsePage(p);
  assert.equal(output.candidates.length, 1);
  assert.equal(output.candidates[0].cells.quantity?.numeric?.raw, "8");
  assert.ok(output.diagnostics.some(d => d.code === "unparsed_row"));
});
test("possible wrapping links preceding candidate; ordinary footer is not a failed row", () => {
  const p = fixture(); if (p.status === "failed") return;
  p.fragments.push({ ...p.fragments[7], index: 20, str: "continued description", transform: [10, 0, 0, 10, 70, 670] });
  p.fragments.push({ ...p.fragments[7], index: 21, str: "Note: delivery instructions", transform: [10, 0, 0, 10, 20, 650] });
  const output = parsePage(p);
  assert.equal(output.diagnostics.length, 1);
  assert.equal(output.diagnostics[0].rowId, output.candidates[0].id);
});
test("failed reader state, unsupported header, empty table and rotation remain visible", () => {
  const failed: PdfPageResult = { page: 4, status: "failed", error: { code: "page_read_failed", message: "test" } };
  assert.equal(parsePage(failed).reader, failed);
  assert.deepEqual(parsePage(failed).candidates, []);
  assert.ok(parsePage(fixture([])).diagnostics.some(d => d.code === "empty_table"));
  const p = fixture(); if (p.status === "failed") return;
  p.fragments[4].str = "Cost";
  assert.ok(parsePage(p).diagnostics.some(d => d.code === "unsupported_header"));
  p.fragments[4].transform[1] = 10;
  assert.ok(parsePage(p).diagnostics.some(d => d.code === "unsupported_geometry"));
});
test("description phrases do not become document claims; ordinary prose is not a row", () => {
  const p = fixture([["1", "14 pallets loaded", "7", "sheet", "$2.30", "$16.10"]]);
  if (p.status === "failed") return;
  p.fragments.push({ ...p.fragments[7], index: 20, str: "Thank you for your order", transform: [10, 0, 0, 10, 20, 650] });
  const output = parsePage(p);
  assert.deepEqual(output.claims, []);
  assert.deepEqual(output.diagnostics, []);
});
test("pallet tokens retain signs and never match a suffix of a malformed number", () => {
  const p = fixture([]); if (p.status === "failed") return;
  p.fragments.unshift({ ...p.fragments[0], index: 20, str: "Summary: -3 pallets loaded; 1,23 pallets unloaded", transform: [10, 0, 0, 10, 20, 740] });
  const output = parsePage(p);
  assert.equal(output.claims.length, 1);
  assert.ok(output.diagnostics.some(d => d.code === "unparsed_claim"));
  const claim = output.claims[0];
  assert.equal(claim.type, "pallet_count");
  if (claim.type === "pallet_count") assert.equal(claim.count.raw, "-3");
});
