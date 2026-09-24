# instaquote-take-home

**Tasks 1–3: shell, contracts, PDF reader and deterministic candidates.** The reader and two supported table layouts are checked against all six samples. Candidate rows retain raw evidence, column mapping and context; they are not validated final results. Business validation, the upload API and results UI are not implemented. See [CANDIDATE_EXTRACTION.md](CANDIDATE_EXTRACTION.md) for parser results and limitations. No OCR/VLM or runtime AI integration is present. See [READER_SPIKE.md](READER_SPIKE.md) for reader results and runtime findings.

## Overview

The task is to extract line items from PDFs without inventing numbers, then show the results and explicit refusals on a small web page. Each extracted number must be traceable to its page and exact source text.

[test.md](test.md) is the authoritative specification. [ANALYSIS.md](ANALYSIS.md) contains the Vietnamese study notes and document inspection. [BASELINE_REVIEW.md](BASELINE_REVIEW.md) records the verified V1 design recommendations, trade-offs and remaining risks.

## Problem Principles

- Return only source-supported numeric values. Do not calculate missing values and present them as extracted facts.
- Keep evidence with each item and preserve enough context to identify each field.
- Explain missing, ambiguous and conflicting information through explicit refusals or warnings.
- Preserve useful results when a separate field or page cannot be processed.
- Carry the reason and scope of refusals and technical failures through the API to the UI.

## Assessment Requirements

**Part A, about three hours:** a PDF-to-JSON service returning extracted line items with page/source-text evidence and a separate list of refusals with reasons.

**Part B, about two hours:** a web page that uploads a document and displays results, evidence and understandable refusals, with useful loading and failure states.

The stack is open. Matching the team's stack is helpful but optional. AI coding agents are expected; the author must understand and explain the implementation. A few tests must specifically cover refusal rules.

Submission requires a repository with visible commit history and answers to the three README questions below. The deadline is 24 hours after receiving the sample files; expected effort is roughly five hours. A smaller finished submission is preferred.

## Sample Document Analysis

All six PDFs were inspected, including all eight pages of KBS-DR118. Direct text extraction and rendered pages were reviewed using the machine's existing PDFKit tooling. This inspection is separate from any future application support.

| Document | Main case |
|---|---|
| [KBS-10234](data/KBS-10234.pdf) | Text-based happy path: five complete rows; printed total of $2,630.00 matches the line totals. |
| [KBS-10241](data/KBS-10241.pdf) | Image-only in the text-reading check. Four rows are visible; no extracted text does not mean no items. |
| [KBS-10255](data/KBS-10255.pdf) | Four rows with quantities, weights and unit prices, but no printed line totals. Only `480g total` explicitly identifies the weight scope. |
| [KBS-10262](data/KBS-10262.pdf) | Three clear rows; the summary says 14 pallets loaded and the driver says 16 unloaded. The discrepancy is unresolved; neither claim should silently win. |
| [KBS-10270](data/KBS-10270.pdf) | Printed total is $1,612.90. An analysis-only sum of the four printed line totals is $1,538.20. The difference is unexplained; no freight amount is stated. |
| [KBS-DR118](data/KBS-DR118.pdf) | Eight pages; page 4 has no usable text layer in the check. Delivery, summary, returns, credit and acceptance contexts must remain distinct. |

The calculations above are review findings, not application output. Full row data and page references are in ANALYSIS.md. No sample PDF was modified.

## Intended Result Contract

The types are defined in [lib/contracts.ts](lib/contracts.ts); runtime validation and processing are not implemented. `ExtractionResult` has `items`, `refusals` and `issues`. Items carry shared, non-empty evidence and optional source context. Numeric fields use `{ value, raw }`, with a decimal string value and the original source token. `lineTotal` is optional. Refusals explain what could not be extracted; issues distinguish source warnings from recoverable page errors. Fatal request failures use the separate `ApiError` type. Optional absent fields do not automatically generate refusals.

TypeScript cannot prove that a quote supports a number, that a page exists, or that a decimal string is valid. Those checks remain planned validation work; the current contracts do not enforce them at runtime.

Acceptance means the value is supported by the source. It does not mean the document is internally consistent: a printed total may be preserved with a mismatch warning. A partial result must identify the unread or unresolved portion.

## Key Engineering Decisions

Current direction; the shell, contracts, page reader and candidate parser are implemented:

- One Next.js + TypeScript app is set up. The planned server endpoint and validation remain unimplemented; no separate backend or tRPC layer is added.

- Validate candidate structure, evidence and business meaning independently of how candidates are generated.
- Use arithmetic for internal consistency checks; do not fill missing extracted values.
- Keep page and document context, especially for returns and credits. Do not infer signs, net quantities or duplicate relationships.
- Use page-by-page text reading and deterministic extraction for supported layouts in V1. Unreadable pages and unsupported table content must not silently become empty success. The reader uses pdfjs-dist 6.3.289; candidate parsing reports unsupported tables/rows internally; final refusal mapping remains unimplemented.
- Defer OCR/VLM to a later version unless the core submission is complete and the fallback can be verified. No runtime LLM is planned for V1.

## Testing Focus

Planned tests focus on refusing inferred totals, surfacing conflicting claims while preserving unrelated items, validating evidence and containing page failures. An integration check should verify that a specific refusal reason survives the service/API/UI path. A clean document should also be accepted without unnecessary refusal.

## Known Limitations / Uncertainties

The reader returns `no_usable_text` for KBS-10241 and page 4 of KBS-DR118, preserving the other readable pages. Domain refusal mapping and user-facing display are not implemented. A page containing some text is not proof that all of its content or tables were read. Visual inspection of the image pages does not establish working OCR. The specification does not define a complete field schema or a verification standard for OCR transcriptions.

The documents do not resolve the ambiguous weight scopes, pallet discrepancy, total mismatch or accounting relationships among KBS-DR118's later pages. Its “Signed Acceptance” heading alone is not evidence of an actual signature. These limits should remain explicit rather than being filled with assumptions.

## Required Assessment Questions

### 1. What was the hardest decision and why did you choose that approach?

**TBD after implementation.** The current recommendation limits V1 to text reading and explicit page refusals. The final answer should explain whether this trade-off held up during implementation and verification.

### 2. Where are you not confident?

At this stage, reliable numeric transcription and evidence verification on image-only pages remain untested. The unresolved document meanings listed above cannot be settled from the supplied sources. The deterministic parser passes the supplied text samples and focused geometry/coverage tests, but fragmented headers, wrapping and hybrid image/text tables remain coverage risks. Candidates are not yet independently validated. This answer must be updated with observed implementation limitations.

### 3. What would you do with three more days?

Preliminary priorities, to revisit after implementation:

- Evaluate image reading on varied scans and add page-region evidence for review.
- Expand negative tests for fabricated evidence, damaged pages, prompt injection and lost API/UI error details.
- Refine document-context rules using confirmed delivery/returns/credit requirements.
- Add stage timings and issue metrics to distinguish extraction limitations from operational failures.

## Running the Project

Use Node.js 22.13 or newer (verified locally with Node.js 22.14.0) and npm. The minimum was raised for pdfjs-dist 6.3.289.

```sh
npm ci
npm run dev
```

Open http://localhost:3000 to view the placeholder shell. Document upload and extraction are not available yet; `/api/extract` has no route handler.

```sh
npm run typecheck
npm run build
npm start
```

Dependency versions are pinned in `package.json` and `package-lock.json`.

The project uses Next.js 16.3.6, React 19.3.0 and TypeScript 7.0.2. Reader execution was also checked in Next.js development and production Node runtimes using a temporary probe, removed after verification. `next.config.ts` externalizes pdfjs-dist to preserve worker resolution. This does not establish line-item extraction support.

`npm run typecheck` generates Next.js types before running TypeScript, so it does not require a previous build. `next-env.d.ts` is generated and ignored. Next.js also generated `AGENTS.md` and `CLAUDE.md` with local framework guidance.

## Tests

Reader tests use Node's built-in test runner with tsx:

```sh
npm run test:reader
npm run verify:reader
npm run test:parser
npm run verify:candidates
```

The eight tests cover the six samples, page numbering, no-text states, invalid/corrupt input, and synthetic page-local failures. Verification prints actual page states; pass an output directory to save raw text/fragments for inspection:

```sh
npm run verify:reader -- /tmp/insta-quote-reader-output
```

The 13 parser tests cover source-backed row/claim mapping on all six samples and synthetic geometry, blank cells, unreadable states and coverage diagnostics. Business refusal, final evidence validation, API and UI tests remain future work in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Typecheck/build success alone does not prove extraction or evidence correctness.
