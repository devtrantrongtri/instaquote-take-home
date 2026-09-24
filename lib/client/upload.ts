import type { ExtractionResult } from "../contracts";

export type UploadState =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | { kind: "error"; message: string }
  | { kind: "result"; filename: string; result: ExtractionResult };

/** Transport handling only; source and business validation stay on the server. */
export async function uploadPdf(file: File, send: typeof fetch = fetch): Promise<UploadState> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await send("/api/extract", { method: "POST", body: form });
  } catch {
    return { kind: "error", message: "Could not connect to the server. Check your connection and try again." };
  }
  let body;
  try { body = await response.json(); } catch {
    return { kind: "error", message: "The server returned an unreadable response. Please try again." };
  }
  if (!response.ok) {
    return { kind: "error", message: typeof body?.error?.message === "string" && body.error.message.trim()
      ? body.error.message : "The server could not process the upload and did not provide a reason. Please try again." };
  }
  if (!body || !Array.isArray(body.items) || !Array.isArray(body.refusals) || !Array.isArray(body.issues)) {
    return { kind: "error", message: "The server response is missing extraction results. Please try again." };
  }
  return { kind: "result", filename: file.name, result: body };
}
