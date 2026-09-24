import type { Evidence, ExtractionResult, ItemField, LineItem, Scope } from "../lib/contracts";

const fields: Record<ItemField, string> = {
  description: "Description", quantity: "Quantity", unit: "Quantity unit", unitPrice: "Unit price",
  priceBasis: "Price basis", lineTotal: "Line total", weightRaw: "Printed weight",
};
const issueTitles = {
  ambiguous_weight: "Weight meaning is unclear", pallet_discrepancy: "Pallet counts differ",
  total_mismatch: "Printed totals do not match", consistency_not_checked: "Consistency could not be checked",
  page_processing_failed: "Page processing failed",
};
function scopeLabel(scope: Scope, items: LineItem[]): string {
  if (scope.kind === "document") return "Document";
  let text = `Page ${scope.page}`;
  if (scope.kind === "row" || scope.kind === "field") {
    const item = items.find(i => i.id === scope.rowId);
    text += item ? ` · ${item.description}` : " · Table row";
  }
  if (scope.kind === "field") text += ` · ${fields[scope.field]}`;
  return text;
}
export function SourceEvidence({ entries }: { entries: Evidence[] }) {
  if (!entries.length) return null;
  return <details className="evidence"><summary>View source evidence</summary>
    {entries.map((entry, i) => <div className="quote" key={i}>
      <span className="page-label">Page {entry.page}</span><pre>{entry.sourceText}</pre>
    </div>)}
  </details>;
}
export function ExtractionResults({ result, filename }: { result: ExtractionResult; filename: string }) {
  const partial = result.refusals.length > 0 || result.issues.some(i => i.kind === "technical_error");
  const title = result.items.length === 0 ? "No items could be extracted"
    : partial ? "Partial results" : result.issues.length ? "Results need review" : "Extracted items ready";
  const groups: { page: number; context: string | undefined; items: LineItem[] }[] = [];
  for (const item of result.items) {
    const page = item.evidence[0].page;
    const last = groups.at(-1);
    if (last && last.page === page && last.context === item.context) last.items.push(item);
    else groups.push({ page, context: item.context, items: [item] });
  }
  function cell(item: LineItem, field: ItemField, value: string | undefined) {
    if (value !== undefined) return value;
    const refusal = result.refusals.find(r => r.scope.kind === "field" && r.scope.rowId === item.id && r.scope.field === field);
    return <span className="missing" title={refusal?.reason}>{refusal ? "Could not read — see refusals" : "Not provided"}</span>;
  }
  return <section className="results" aria-label="Extraction results">
    <div className={`notice ${partial ? "partial" : result.issues.length ? "warning" : "neutral"}`} role="status">
      <h2>{title}</h2><p className="filename">{filename}</p>
      <p>{result.items.length} extracted items · {result.refusals.length} {result.refusals.length === 1 ? "refusal" : "refusals"} · {result.issues.length} {result.issues.length === 1 ? "issue" : "issues"}</p>
      {partial && <p>{result.items.length > 0 ? "Some parts of this document could not be processed. The extracted results below are partial." : "The document could not be fully processed. See the reasons below."}</p>}
      {!partial && result.issues.length > 0 && <p>Source values are preserved. Review the issues below before using these results.</p>}
      {!partial && result.items.length === 0 && <p>No supported items were identified. This does not establish that the document contains no items.</p>}
      <nav aria-label="Result sections">
        {result.items.length > 0 && <a href="#items">Items</a>}
        {result.refusals.length > 0 && <a href="#refusals">Refusals</a>}
        {result.issues.length > 0 && <a href="#issues">Issues</a>}
      </nav>
    </div>
    {groups.length > 0 && <section id="items" aria-labelledby="items-title"><h2 id="items-title">Extracted items</h2>
      {groups.map((group, index) => {
        const weight = group.items.some(i => i.weightRaw !== undefined);
        return <section className="item-group" key={index} aria-label={`Page ${group.page} items`}>
          <div className="group-heading"><h3>Page {group.page}</h3>{group.context && <p className="context">{group.context}</p>}</div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`Item table on page ${group.page}`}>
            <table><caption className="sr-only">Source-backed items on page {group.page}</caption><thead><tr>
              <th scope="col">Description</th><th scope="col">Quantity</th><th scope="col">Unit</th><th scope="col">Unit price</th><th scope="col">Line total</th>{weight && <th scope="col">Printed weight</th>}
            </tr></thead>
              {group.items.map(item => <tbody key={item.id}><tr>
                <th scope="row">{item.description}</th>
                <td>{cell(item, "quantity", item.quantity?.raw)}</td>
                <td>{cell(item, "unit", item.unit)}</td>
                <td>{cell(item, "unitPrice", item.unitPrice?.raw)}{item.priceBasis && <span className="price-basis"> {item.priceBasis}</span>}</td>
                <td>{cell(item, "lineTotal", item.lineTotal?.raw)}</td>
                {weight && <td>{cell(item, "weightRaw", item.weightRaw)}</td>}
              </tr><tr className="evidence-row"><td colSpan={weight ? 6 : 5}><SourceEvidence entries={item.evidence} /></td></tr></tbody>)}
            </table>
          </div>
        </section>;
      })}
    </section>}
    {result.refusals.length > 0 && <section id="refusals" aria-labelledby="refusals-title"><h2 id="refusals-title">Refusals — information not extracted</h2>
      {result.refusals.map((refusal, i) => <article className="notice partial" key={i}>
        <h3>{scopeLabel(refusal.scope, result.items)}</h3><p>{refusal.reason}</p>
        {refusal.evidence && <SourceEvidence entries={refusal.evidence} />}
      </article>)}
    </section>}
    {result.issues.length > 0 && <section id="issues" aria-labelledby="issues-title"><h2 id="issues-title">Issues — review required</h2>
      {result.issues.map((issue, i) => <article className={`notice ${issue.kind === "technical_error" ? "error" : "warning"}`} key={i}>
        <span className="eyebrow">{issue.kind === "technical_error" ? "Processing issue" : "Source warning"}</span>
        <h3>{issueTitles[issue.code]}</h3><p className="scope">{scopeLabel(issue.scope, result.items)}</p><p>{issue.reason}</p>
        {issue.evidence && <SourceEvidence entries={issue.evidence} />}
      </article>)}
    </section>}
  </section>;
}
