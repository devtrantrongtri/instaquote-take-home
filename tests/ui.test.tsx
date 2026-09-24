import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtractionResults } from "../components/extraction-result";
import UploadForm, { UploadFeedback } from "../components/upload-form";
import { uploadPdf } from "../lib/client/upload";
import type { ExtractionResult } from "../lib/contracts";
import { extractDocument } from "../lib/extract-document";

const item = { id: "row-1", description: "Board 10mm", quantity: { raw: "48", value: "48" }, evidence: [{ page: 1, sourceText: "1  Board 10mm  48 sheet" }] } satisfies ExtractionResult["items"][number];
const empty: ExtractionResult = { items: [], refusals: [], issues: [] };
const render = (result: ExtractionResult) => renderToStaticMarkup(<ExtractionResults result={result} filename="document.pdf" />);
const file = () => new File(["pdf bytes"], "document.pdf", { type: "application/pdf" });
const sender = (response: Response): typeof fetch => async () => response;

test("initial form labels file selection and disables submission without a file", () => {
  const html = renderToStaticMarkup(<UploadForm />);
  assert.match(html, /Choose a PDF document/); assert.match(html, /accept=".pdf,application\/pdf"/);
  assert.match(html, /type="submit" disabled=""/); assert.match(html, /No file selected/);
});
test("loading status and fatal API message render as distinct accessible states", () => {
  const loading = renderToStaticMarkup(<UploadFeedback state={{ kind: "loading", filename: "document.pdf" }} />);
  assert.match(loading, /role="status"/); assert.match(loading, /Reading and validating the document/);
  assert.doesNotMatch(loading, /Extracted items ready/);
  const error = renderToStaticMarkup(<UploadFeedback state={{ kind: "error", message: "The PDF could not be opened. It may be damaged or incomplete." }} />);
  assert.match(error, /role="alert"/); assert.match(error, /The PDF could not be opened. It may be damaged or incomplete./);
});
test("clean item and exact evidence render without invented optional values", () => {
  const html = render({ ...empty, items: [item] });
  assert.match(html, /Extracted items ready/); assert.match(html, /Board 10mm/); assert.match(html, /Page 1/);
  assert.match(html, /1  Board 10mm  48 sheet/); assert.match(html, /<details/); assert.match(html, /Not provided/);
  assert.doesNotMatch(html, />0<|\$0|Partial results|Issues — review required/);
});
test("partial results retain items and show refusal reasons and targets", () => {
  const html = render({ ...empty, items: [item], refusals: [{ scope: { kind: "page", page: 4 }, code: "no_usable_text", reason: "The current reader could not reliably extract this page." }] });
  assert.match(html, /Partial results/); assert.match(html, /extracted results below are partial/);
  assert.match(html, /Board 10mm/); assert.match(html, /Page 4/); assert.match(html, /The current reader could not reliably extract this page./);
});
test("field refusal is not presented as optional absence", () => {
  const html = render({ ...empty, items: [item], refusals: [{ scope: { kind: "field", page: 1, rowId: item.id, field: "lineTotal" }, code: "unsupported_field", reason: "The printed line total could not be verified." }] });
  assert.match(html, /Could not read — see refusals/); assert.match(html, /The printed line total could not be verified./);
});
test("warning-only result needs review without implying unread pages", () => {
  const html = render({ ...empty, items: [item], issues: [{ kind: "warning", code: "pallet_discrepancy", scope: { kind: "page", page: 1 }, reason: "Loading and unloading counts differ.", evidence: [{ page: 1, sourceText: "14 pallets loaded" }, { page: 1, sourceText: "16 pallets unloaded" }] }] });
  assert.match(html, /Results need review/); assert.match(html, /Source warning/); assert.match(html, /Loading and unloading counts differ./);
  assert.match(html, /14 pallets loaded/); assert.match(html, /16 pallets unloaded/); assert.doesNotMatch(html, /results below are partial/);
});
test("technical page issue is distinct and does not hide items", () => {
  const html = render({ ...empty, items: [item], issues: [{ kind: "technical_error", code: "page_processing_failed", scope: { kind: "page", page: 2 }, reason: "Text reading failed on this page." }] });
  assert.match(html, /Partial results/); assert.match(html, /Processing issue/); assert.match(html, /Page 2/); assert.match(html, /Board 10mm/);
});
test("unreadable document is not shown as empty success", () => {
  const html = render({ ...empty, refusals: [{ scope: { kind: "page", page: 1 }, code: "no_usable_text", reason: "This page could not be read." }] });
  assert.match(html, /No items could be extracted/); assert.match(html, /This page could not be read./);
  assert.doesNotMatch(html, /Extracted items ready|No items found/);
});
test("source and filename are escaped as text", () => {
  const html = renderToStaticMarkup(<ExtractionResults filename="<script>bad()</script>" result={{ ...empty, items: [{ ...item, description: "<img onerror=bad()>", evidence: [{ page: 1, sourceText: "<script>source</script>" }] }] }} />);
  assert.doesNotMatch(html, /<script>|<img /); assert.match(html, /&lt;script&gt;source/);
});
test("upload helper uses multipart file and preserves success payload", async () => {
  const result = { ...empty, items: [item] };
  const send: typeof fetch = async (input, init) => {
    assert.equal(input, "/api/extract"); assert.equal(init?.method, "POST"); assert.ok(init.body instanceof FormData);
    assert.equal((init.body.get("file") as File).name, "document.pdf"); assert.equal(init.headers, undefined);
    return Response.json(result);
  };
  assert.deepEqual(await uploadPdf(file(), send), { kind: "result", filename: "document.pdf", result });
});
test("structured fatal API reason survives transport and rendering", async () => {
  const message = "Password-protected PDFs are not supported. Upload an unprotected copy.";
  const state = await uploadPdf(file(), sender(Response.json({ error: { code: "unsupported_encryption", message } }, { status: 422 })));
  assert.deepEqual(state, { kind: "error", message });
  assert.ok(renderToStaticMarkup(<UploadFeedback state={state} />).includes(message));
});
test("network and malformed responses get useful safe fallback messages", async () => {
  const send: typeof fetch = async () => { throw new Error("private internal stack"); };
  const network = await uploadPdf(file(), send); assert.equal(network.kind, "error");
  assert.match(JSON.stringify(network), /Could not connect/); assert.doesNotMatch(JSON.stringify(network), /private/);
  for (const response of [new Response("<html>private error</html>", { status: 500 }), Response.json({ items: [] }), Response.json({}, { status: 500 })]) {
    const state = await uploadPdf(file(), sender(response)); assert.equal(state.kind, "error"); assert.doesNotMatch(JSON.stringify(state), /private|<html>/);
  }
});
for (const [name, count] of [["KBS-10234", 5], ["KBS-10241", 0], ["KBS-10255", 4], ["KBS-10262", 3], ["KBS-10270", 4], ["KBS-DR118", 21]] as const) {
  test(`${name}: actual extraction reasons, context and source text reach rendered UI`, async () => {
    const result = await extractDocument(await readFile(`data/${name}.pdf`));
    const html = render(result); assert.ok(html.includes(`${count} extracted items`));
    const escaped = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
    for (const note of [...result.refusals, ...result.issues]) assert.ok(html.includes(escaped(note.reason)));
    for (const row of result.items) {
      assert.ok(html.includes(escaped(row.description))); if (row.context) assert.ok(html.includes(escaped(row.context)));
      for (const q of row.evidence) assert.ok(html.includes(escaped(q.sourceText)));
    }
    if (name === "KBS-10255") assert.doesNotMatch(html, /272\.00/);
    if (name === "KBS-10270") assert.doesNotMatch(html, /1,538\.20|74\.70/);
  });
}
