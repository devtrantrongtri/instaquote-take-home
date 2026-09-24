import type { ApiError } from "../contracts";
import { extractDocument } from "../extract-document";
import { PdfDocumentReadError } from "../pdf/read-pages";

function errorResponse(status: number, code: ApiError["error"]["code"], message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

/** Thin HTTP boundary. Injection is only for testing fatal/local failure mapping. */
export async function handleExtractionRequest(request: Request, extract: typeof extractDocument = extractDocument): Promise<Response> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "multipart/form-data") {
    return errorResponse(400, "invalid_upload", "Send a PDF using multipart/form-data with the file field named 'file'.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(400, "invalid_upload", "The upload could not be read as multipart form data. Please upload the file again.");
  }
  const files = form.getAll("file");
  if (files.length !== 1) return errorResponse(400, "invalid_upload", "Upload exactly one PDF in the 'file' field.");
  const file = files[0];
  if (!(file instanceof Blob)) return errorResponse(400, "invalid_upload", "The 'file' field must contain an uploaded PDF file, not text.");
  if ([...form.entries()].some(([name, value]) => name !== "file" && value instanceof Blob)) {
    return errorResponse(400, "invalid_upload", "Upload only one file, using the field named 'file'.");
  }
  if (!file.size) return errorResponse(400, "invalid_upload", "The uploaded file is empty. Choose a PDF containing document data.");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return errorResponse(400, "invalid_upload", "The uploaded file could not be read. Please upload it again.");
  }
  // MIME and extension are client hints, not proof. Allow missing/generic or
  // inaccurate MIME labels; require a plausible PDF header near the start.
  // PDF.js performs actual document validation, including corrupt/encrypted files.
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!header.includes("%PDF-")) return errorResponse(400, "invalid_upload", "The uploaded file does not have a recognizable PDF header. Choose a PDF document.");
  try {
    return Response.json(await extract(bytes));
  } catch (error) {
    if (error instanceof PdfDocumentReadError) {
      if (error.code === "unreadable_pdf") return errorResponse(422, "unreadable_pdf", "The PDF could not be opened. It may be damaged or incomplete.");
      if (error.code === "unsupported_encryption") return errorResponse(422, "unsupported_encryption", "Password-protected PDFs are not supported. Upload an unprotected copy.");
      return errorResponse(500, "processing_failed", "The PDF reader could not start. Please try again later.");
    }
    return errorResponse(500, "processing_failed", "Document extraction could not finish. Please try again later.");
  }
}
