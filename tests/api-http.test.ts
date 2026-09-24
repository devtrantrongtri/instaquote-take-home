import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractDocument } from "../lib/extract-document";

// Requires a running Next dev/start server. No server or browser framework added.
const base = process.env.API_BASE_URL;
if (!base) throw new Error("Set API_BASE_URL to the running Next server, e.g. http://127.0.0.1:3100");
const endpoint = new URL("/api/extract", base);
async function post(form: FormData) { return fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(60000) }); }
for (const [name, count] of [["KBS-10234", 5], ["KBS-10241", 0], ["KBS-10255", 4], ["KBS-10262", 3], ["KBS-10270", 4], ["KBS-DR118", 21]] as const) {
  test(`HTTP ${name}: status, counts and full JSON equal standalone pipeline`, async () => {
    const bytes = await readFile(`data/${name}.pdf`);
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), `${name}.pdf`);
    const response = await post(form);
    assert.equal(response.status, 200); assert.match(response.headers.get("content-type")!, /application\/json/);
    const result = await response.json(); assert.equal(result.items.length, count);
    assert.deepEqual(result, await extractDocument(bytes));
    console.log(`${name}: HTTP ${response.status}, ${count} items, ${result.refusals.length} refusals, ${result.issues.length} issues`);
  });
}
for (const [kind, status, code] of [["missing", 400, "invalid_upload"], ["non-pdf", 400, "invalid_upload"], ["corrupt", 422, "unreadable_pdf"]] as const) {
  test(`HTTP ${kind}: structured safe error`, async () => {
    const form = new FormData();
    if (kind !== "missing") form.append("file", new Blob([kind === "corrupt" ? "%PDF-1.7\ninvalid" : "not a PDF"], { type: "application/pdf" }), "input.pdf");
    const response = await post(form); assert.equal(response.status, status);
    const body = await response.json(); assert.deepEqual(Object.keys(body), ["error"]); assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /\/Users\/|pdfjs|stack|node_modules/i);
  });
}
