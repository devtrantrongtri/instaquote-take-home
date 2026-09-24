import type { PdfPageResult, PdfTextFragment } from "../pdf/read-pages";

/** Internal source ledger, copied/frozen before parsing; never normalized. */
export type SourceFragment = Readonly<Omit<PdfTextFragment, "transform"> & {
  transform: readonly number[];
}>;
export type SourceQuote = {
  page: number;
  /** Source strings in visual order; only inter-fragment spaces may be inserted. */
  sourceText: string;
  fragmentIndices: number[];
};
export type SourceLine = SourceQuote & { id: string; y: number };
export type CandidateNumericField = {
  raw: string;
  /** Offsets into source.sourceText; no normalized or calculated value yet. */
  start: number;
  end: number;
  source: SourceQuote;
};
export type Column = "item" | "description" | "quantity" | "unit" | "weightRaw" | "unitPrice" | "lineTotal";
export type TableHeader = {
  id: string;
  kind: "standard" | "weight";
  source: SourceQuote;
  columns: { field: Column; x: number }[];
};
export type CandidateCell = {
  /** A present column may be empty or contain an unrecognized numeric token. */
  source: SourceQuote;
  numeric?: CandidateNumericField;
  priceBasis?: string;
};
export type CandidateLineItem = {
  id: string;
  page: number;
  headerId: string;
  source: SourceQuote;
  /** Missing key = absent column, empty sourceText = present but blank cell. */
  cells: Partial<Record<Column, CandidateCell>>;
  context: SourceQuote[];
};
export type CandidateClaim = {
  page: number;
  source: SourceQuote;
  context: SourceQuote[];
} & (
  | { type: "printed_total"; amount: CandidateNumericField }
  | { type: "pallet_count"; count: CandidateNumericField; qualifier: "loaded" | "unloaded" }
);
export type ParserDiagnostic = {
  code: "unsupported_geometry" | "unsupported_header" | "no_supported_table" | "empty_table" | "unparsed_row" | "unparsed_claim" | "unrecognized_cell";
  reason: string;
  source: SourceQuote;
  rowId?: string;
  field?: Column;
};
export type PageExtractionResult = {
  /** Reader state survives unchanged, including failed/no_usable_text. */
  reader: PdfPageResult;
  ledger: readonly SourceFragment[];
  lines: SourceLine[];
  headers: TableHeader[];
  context: SourceQuote[];
  candidates: CandidateLineItem[];
  claims: CandidateClaim[];
  diagnostics: ParserDiagnostic[];
};
