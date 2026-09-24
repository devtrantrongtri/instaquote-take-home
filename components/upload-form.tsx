"use client";

import { useRef, useState, type FormEvent } from "react";
import { uploadPdf, type UploadState } from "../lib/client/upload";
import { ExtractionResults } from "./extraction-result";

export function UploadFeedback({ state }: { state: UploadState }) {
  if (state.kind === "loading") return <p className="notice neutral" role="status">Reading and validating the document...</p>;
  if (state.kind === "error") return <div className="notice error" role="alert"><h2>Upload could not be processed</h2><p>{state.message}</p></div>;
  if (state.kind === "result") return <ExtractionResults result={state.result} filename={state.filename} />;
  return null;
}
export default function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const inFlight = useRef(false);
  const loading = state.kind === "loading";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || inFlight.current) return;
    if (file.size === 0) { setState({ kind: "error", message: "The selected file is empty. Choose a PDF containing document data." }); return; }
    inFlight.current = true;
    setState({ kind: "loading", filename: file.name }); // Remove stale results/errors immediately.
    try { setState(await uploadPdf(file)); }
    finally { inFlight.current = false; }
  }
  return <>
    <form className="upload-panel" onSubmit={submit} aria-busy={loading}>
      <label htmlFor="pdf-file">Choose a PDF document</label>
      <p id="upload-help">Upload a packing list, invoice or delivery docket. Pages without readable text will be reported explicitly.</p>
      <div className="upload-controls">
        <input id="pdf-file" name="file" type="file" accept=".pdf,application/pdf" aria-describedby="upload-help selected-file" disabled={loading}
          onChange={event => { setFile(event.target.files?.[0] ?? null); setState({ kind: "idle" }); }} />
        <button type="submit" disabled={!file || loading}>{loading ? "Processing…" : "Extract items"}</button>
      </div>
      <p id="selected-file" className="selected-file">{file ? `Selected: ${file.name}` : "No file selected"}</p>
    </form>
    <UploadFeedback state={state} />
  </>;
}
