import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { POST, runtime } from "../app/api/extract/route";
import { handleExtractionRequest } from "../lib/api/extract";
import type { ExtractionResult } from "../lib/contracts";
import { extractDocument } from "../lib/extract-document";
import { PdfDocumentReadError } from "../lib/pdf/read-pages";

function request(form: FormData) { return new Request("http://localhost/api/extract", { method: "POST", body: form }); }
function upload(bytes: Uint8Array = new TextEncoder().encode("%PDF-1.7\ninvalid"), type = "application/pdf", name = "upload.pdf") {
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)], { type }), name); return request(form);
}
async function assertError(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.match(response.headers.get("content-type")!, /application\/json/);
  const body = await response.json(); assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(body.error.code, code); assert.equal(typeof body.error.message, "string");
  assert.doesNotMatch(JSON.stringify(body), /private-path|pdfjs|stack trace|secret/i);
}

test("route explicitly uses Node; missing file is a structured request error", async () => {
  assert.equal(runtime, "nodejs"); await assertError(await POST(request(new FormData())), 400, "invalid_upload");
});
for (const kind of ["text", "duplicate", "extra-file", "empty", "not-pdf"] as const) {
  test(`invalid upload: ${kind}`, async () => {
    const form = new FormData();
    if (kind === "text") form.append("file", "/private-path/document.pdf");
    else {
      form.append("file", new Blob([kind === "empty" ? "" : "not a PDF"], { type: "application/pdf" }), "fake.pdf");
      if (kind === "duplicate") form.append("file", new Blob(["second"]), "second.pdf");
      if (kind === "extra-file") form.append("another", new Blob(["second"]), "second.pdf");
    }
    await assertError(await POST(request(form)), 400, "invalid_upload");
  });
}
test("non-multipart and malformed multipart receive safe errors", async () => {
  for (const contentType of ["application/json", "multipart/form-data", "multipart/form-data; boundary=absent"]) {
    const req = new Request("http://localhost/api/extract", { method: "POST", headers: { "content-type": contentType }, body: "broken body" });
    await assertError(await POST(req), 400, "invalid_upload");
  }
});
for (const [name, count, refusal, issue] of [
  ["KBS-10234", 5, undefined, undefined], ["KBS-10241", 0, "no_usable_text", undefined],
  ["KBS-10255", 4, undefined, "ambiguous_weight"], ["KBS-10262", 3, undefined, "pallet_discrepancy"],
  ["KBS-10270", 4, undefined, "total_mismatch"], ["KBS-DR118", 21, "no_usable_text", undefined],
] as const) {
  test(`${name}: route preserves the complete service result`, async () => {
    const bytes = await readFile(`data/${name}.pdf`);
    const response = await POST(upload(bytes)); assert.equal(response.status, 200);
    const body = await response.json(); assert.deepEqual(body, await extractDocument(bytes));
    assert.equal(body.items.length, count);
    assert.deepEqual(body.refusals.map((r: { code: string }) => r.code), refusal ? [refusal] : []);
    assert.deepEqual(body.issues.map((i: { code: string }) => i.code), issue ? [issue] : []);
  });
}
test("filename and MIME cannot override PDF bytes, including missing/generic MIME", async () => {
  const bytes = await readFile("data/KBS-10234.pdf");
  for (const type of ["", "application/octet-stream", "text/plain"]) {
    const response = await POST(upload(bytes, type, "unrelated.bin"));
    assert.equal(response.status, 200); assert.equal((await response.json()).items.length, 5);
  }
});
test("corrupt PDF with a header maps to a safe fatal document error", async () => {
  await assertError(await POST(upload()), 422, "unreadable_pdf");
});
for (const [code, status, publicCode] of [
  ["unreadable_pdf", 422, "unreadable_pdf"], ["unsupported_encryption", 422, "unsupported_encryption"],
  ["reader_unavailable", 500, "processing_failed"],
] as const) {
  test(`fatal mapping: ${code}`, async () => {
    const response = await handleExtractionRequest(upload(), async () => { throw new PdfDocumentReadError(code, "/private-path/pdfjs secret stack trace"); });
    await assertError(response, status, publicCode);
  });
}
test("unexpected failures never expose exception text", async () => {
  await assertError(await handleExtractionRequest(upload(), async () => { throw new Error("/private-path/secret stack trace"); }), 500, "processing_failed");
});
test("page-local failures and domain refusal scopes/reasons survive serialization with HTTP 200", async () => {
  const result: ExtractionResult = { items: [], refusals: [{ code: "no_usable_text", scope: { kind: "page", page: 4 }, reason: "The current reader could not read this page." }],
    issues: [{ kind: "technical_error", code: "page_processing_failed", scope: { kind: "page", page: 2 }, reason: "Text reading failed on this page." }] };
  const response = await handleExtractionRequest(upload(), async () => result);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), result);
});
