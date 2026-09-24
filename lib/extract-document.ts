import type { ExtractionResult } from "./contracts";
import { parsePage } from "./extraction/parse-page";
import { readPdfPages, type PdfReadResult } from "./pdf/read-pages";
import { validatePage } from "./validation/validate-page";

/** A narrow parser injection seam tests page-local exceptions without an API. */
export function extractReadDocument(document: PdfReadResult, parser: typeof parsePage = parsePage): ExtractionResult {
  if (!Number.isInteger(document.pageCount) || document.pageCount < 1
    || document.pages.length !== document.pageCount
    || document.pages.some((p, i) => p.page !== i + 1)) throw new Error("Invalid document page sequence.");
  const result: ExtractionResult = { items: [], refusals: [], issues: [] };
  for (const page of document.pages) {
    try {
      const parsed = parser(page);
      if (parsed.reader !== page) throw new Error("Parser replaced reader provenance.");
      const validated = validatePage(parsed, document.pageCount === 1);
      result.items.push(...validated.items);
      result.refusals.push(...validated.refusals);
      result.issues.push(...validated.issues);
    } catch {
      // Never expose internal exception text or turn a local failure into a
      // whole-document failure. Commit page output only after validation succeeds.
      result.issues.push({ kind: "technical_error", code: "page_processing_failed", scope: { kind: "page", page: page.page },
        reason: "Extraction or source validation could not finish on this page. Results from other pages have been preserved." });
    }
  }
  return result;
}

/** Fatal opening/reader errors deliberately reject outside ExtractionResult. */
export async function extractDocument(bytes: Uint8Array): Promise<ExtractionResult> {
  return extractReadDocument(await readPdfPages(bytes));
}
