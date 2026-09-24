/** A quote from the source, using the original PDF's one-based page number. */
export type Evidence = {
  page: number;
  sourceText: string;
};

/**
 * A source-backed numeric token, never an arithmetic result.
 * `value` is its normalized decimal string; `raw` preserves the source token.
 * Both must be supported by the containing item's row/header evidence.
 * These types do not perform runtime evidence or decimal validation.
 */
export type SourceNumber = {
  value: string;
  raw: string;
};

export type LineItem = {
  /** Generated row locator; not a business value extracted from the document. */
  id: string;
  description: string;
  quantity?: SourceNumber;
  /** Explicit quantity unit, distinct from the price basis. */
  unit?: string;
  unitPrice?: SourceNumber;
  priceBasis?: string;
  /** Absence alone does not imply a refusal; never fill this by calculation. */
  lineTotal?: SourceNumber;
  /** Preserve qualifiers without inferring per-unit or total weight. */
  weightRaw?: string;
  /** Source heading/site context, without inferring signs or accounting meaning. */
  context?: string;
  /** Shared quotes must unambiguously support every extracted field. */
  evidence: [Evidence, ...Evidence[]];
};

export type ItemField =
  | "description"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "priceBasis"
  | "lineTotal"
  | "weightRaw";

export type Scope =
  | { kind: "document" }
  | { kind: "page"; page: number }
  | { kind: "row"; page: number; rowId: string }
  | { kind: "field"; page: number; rowId: string; field: ItemField };

/** A deliberate extraction refusal, not a fatal request error. */
export type Refusal = {
  scope: Scope;
  code:
    | "no_usable_text"
    | "unsupported_layout"
    | "unreadable_row"
    | "unsupported_field";
  reason: string;
  /** An unreadable page may have no source text to quote. */
  evidence?: Evidence[];
};

/** Source warnings and recoverable page failures remain distinct. */
export type Issue = {
  scope: Scope;
  reason: string;
  /** Source-related warnings require supporting quotes at runtime. */
  evidence?: Evidence[];
} & (
  | {
      kind: "warning";
      code:
        | "ambiguous_weight"
        | "pallet_discrepancy"
        | "total_mismatch"
        | "consistency_not_checked";
    }
  | { kind: "technical_error"; code: "page_processing_failed" }
);

export type ExtractionResult = {
  items: LineItem[];
  refusals: Refusal[];
  issues: Issue[];
};

/** Fatal request-wide failures use the API error path, outside domain results. */
export type ApiError = {
  error: {
    code:
      | "invalid_upload"
      | "unreadable_pdf"
      | "unsupported_encryption"
      | "processing_failed";
    message: string;
  };
};
