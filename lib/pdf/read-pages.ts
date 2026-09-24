import { dirname, join, sep } from "node:path";
import type {
  PDFPageProxy,
  TextItem,
} from "pdfjs-dist/types/src/display/api";

/** Original PDF.js text item and its position in the page's content stream. */
export type PdfTextFragment = {
  index: number;
  str: string;
  dir: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

type PageText = {
  /** Original one-based page number, including pages without text. */
  page: number;
  /** Convenience transcription, not a layout-preserving table or exact quote. */
  text: string;
  /** Source strings and geometry for later evidence construction. */
  fragments: PdfTextFragment[];
};

export type PdfPageResult =
  | (PageText & { status: "text" | "no_usable_text" })
  | {
      page: number;
      status: "failed";
      error: { code: "page_read_failed"; message: string };
    };

export type PdfReadResult = {
  pageCount: number;
  pages: PdfPageResult[];
};

export class PdfDocumentReadError extends Error {
  readonly code: "unreadable_pdf" | "unsupported_encryption" | "reader_unavailable";

  constructor(code: PdfDocumentReadError["code"], message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "PdfDocumentReadError";
    this.code = code;
  }
}

type PageSource = Pick<PDFPageProxy, "getTextContent" | "cleanup">;

/** Narrow PDF.js boundary, also allows page failures to be exercised in tests. */
type DocumentSource = {
  numPages: number;
  getPage(page: number): Promise<PageSource>;
};

/** @internal Read an already-open document; its owner is responsible for destroy(). */
export async function readDocumentPages(document: DocumentSource): Promise<PdfReadResult> {
  const pages: PdfPageResult[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    let page: PageSource | undefined;
    try {
      page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: true });
      const fragments: PdfTextFragment[] = [];

      content.items.forEach((item, index) => {
        if (!("str" in item)) return; // Marked-content records are not text items.
        const textItem: TextItem = item;
        fragments.push({
          index,
          str: textItem.str,
          dir: textItem.dir,
          transform: [...textItem.transform],
          width: textItem.width,
          height: textItem.height,
          fontName: textItem.fontName,
          hasEOL: textItem.hasEOL,
        });
      });

      // Keep PDF.js order and strings. Whitespace separators are convenience only.
      const text = fragments
        .map((fragment) => fragment.str + (fragment.hasEOL ? "\n" : " "))
        .join("");
      const hasText = fragments.some((fragment) => fragment.str.trim().length > 0);
      pages.push({
        page: pageNumber,
        status: hasText ? "text" : "no_usable_text",
        text,
        fragments,
      });
    } catch (cause) {
      // Do not discard preceding results or silently skip this page.
      pages.push({
        page: pageNumber,
        status: "failed",
        error: {
          code: "page_read_failed",
          message: cause instanceof Error ? cause.message : "Could not read page text.",
        },
      });
    } finally {
      try {
        page?.cleanup();
      } catch {
        // Cleanup must not overwrite an extracted result or its original failure.
        console.warn("PDF page cleanup failed", { page: pageNumber });
      }
    }
  }

  return { pageCount: document.numPages, pages };
}

/**
 * Node-only reader. No OCR, layout interpretation, numeric parsing or business rules.
 * `text` means non-whitespace text was obtained, not that every page region was read.
 * Page errors contain internal diagnostic messages; map them safely at the future API boundary.
 */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfReadResult> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  let task;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Use native Node resolution: Turbopack rewrites a static require.resolve
    // into a module identifier, which is not a filesystem path for font assets.
    const nodeRequire = process.getBuiltinModule("module").createRequire(import.meta.url);
    const packageDirectory = dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
    // Copy: PDF.js may transfer the buffer, and callers may supply a Node Buffer.
    task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      stopAtErrors: true,
      standardFontDataUrl: join(packageDirectory, "standard_fonts") + sep,
    });
  } catch (cause) {
    throw new PdfDocumentReadError("reader_unavailable", "The PDF reader could not be loaded.", cause);
  }

  try {
    let document;
    try {
      document = await task.promise;
    } catch (cause) {
      const encrypted = cause instanceof Error && cause.name === "PasswordException";
      const invalid = cause instanceof Error && cause.name === "InvalidPDFException";
      throw new PdfDocumentReadError(
        encrypted ? "unsupported_encryption" : invalid ? "unreadable_pdf" : "reader_unavailable",
        encrypted ? "Password-protected PDFs are not supported."
          : invalid ? "The PDF document could not be opened."
            : "The PDF reader could not initialize the document.",
        cause,
      );
    }
    return await readDocumentPages(document);
  } finally {
    try {
      await task.destroy();
    } catch {
      console.warn("PDF document cleanup failed");
    }
  }
}
