import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PdfDocumentReadError, readDocumentPages, readPdfPages } from "../lib/pdf/read-pages";

const fixtures = [
  { file: "KBS-10234.pdf", count: 1, noText: [] },
  { file: "KBS-10241.pdf", count: 1, noText: [1] },
  { file: "KBS-10255.pdf", count: 1, noText: [] },
  { file: "KBS-10262.pdf", count: 1, noText: [] },
  { file: "KBS-10270.pdf", count: 1, noText: [] },
  { file: "KBS-DR118.pdf", count: 8, noText: [4] },
];

for (const fixture of fixtures) {
  test(`${fixture.file}: preserve every original page and its text state`, async () => {
    const bytes = await readFile(new URL(`../data/${fixture.file}`, import.meta.url));
    const before = Buffer.from(bytes);
    const result = await readPdfPages(bytes);
    assert.deepEqual(bytes, before, "reader must not detach or modify caller bytes");
    assert.equal(result.pageCount, fixture.count);
    assert.deepEqual(result.pages.map((page) => page.page),
      Array.from({ length: fixture.count }, (_, index) => index + 1));
    assert.deepEqual(result.pages.filter((page) => page.status === "no_usable_text").map((page) => page.page), fixture.noText);
    for (const page of result.pages) {
      assert.notEqual(page.status, "failed");
      if (page.status === "failed") continue;
      assert.equal(page.status, fixture.noText.includes(page.page) ? "no_usable_text" : "text");
      if (page.status === "text") {
        assert.ok(page.text.trim());
        assert.ok(page.fragments.some((fragment) => fragment.str.trim()));
        assert.ok(page.fragments.every((fragment) => fragment.transform.length === 6));
      } else {
        assert.equal(page.text.trim(), "");
      }
    }
  });
}

test("invalid, empty and truncated PDF bytes are fatal, unlike a no-text page", async () => {
  for (const bytes of [new Uint8Array(), Buffer.from("not a PDF"), Buffer.from("%PDF-1.7\n1 0 obj\n<<")]) {
    await assert.rejects(() => readPdfPages(bytes), (error: unknown) =>
      error instanceof PdfDocumentReadError && error.code === "unreadable_pdf");
  }
});

test("page-local failures preserve surrounding pages, original fragments and cleanup", async () => {
  const cleaned: number[] = [];
  const source = "  source text  ";
  const result = await readDocumentPages({
    numPages: 4,
    async getPage(page) {
      if (page === 2) throw new Error("page access failed");
      return {
        cleanup() { cleaned.push(page); return true; },
        async getTextContent() {
          if (page === 3) throw new Error("text decoding failed");
          return {
            items: [{ str: source, dir: "ltr", transform: [1, 0, 0, 1, 12, 34],
              width: 80, height: 12, fontName: "fixture-font", hasEOL: true }],
            styles: {}, lang: null,
          };
        },
      };
    },
  });
  assert.deepEqual(result.pages.map((page) => [page.page, page.status]),
    [[1, "text"], [2, "failed"], [3, "failed"], [4, "text"]]);
  assert.deepEqual(cleaned, [1, 3, 4]);
  const first = result.pages[0];
  assert.ok(first && first.status === "text");
  assert.equal(first.fragments[0]?.str, source);
  assert.equal(first.fragments[0]?.index, 0);
  assert.deepEqual(first.fragments[0]?.transform, [1, 0, 0, 1, 12, 34]);
  const failure = result.pages[2];
  assert.ok(failure && failure.status === "failed");
  assert.equal(failure.error.message, "text decoding failed");
});
