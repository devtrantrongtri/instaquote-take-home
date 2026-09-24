import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readPdfPages } from "../lib/pdf/read-pages";
import { parsePage } from "../lib/extraction/parse-page";

async function main() {
  const outputDirectory = process.argv[2];
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  for (const file of (await readdir("data")).filter(f => f.endsWith(".pdf")).sort()) {
    const document = await readPdfPages(await readFile(join("data", file)));
    const pages = document.pages.map(parsePage);
    console.log(JSON.stringify({ file, pageCount: document.pageCount, pages: pages.map(p => ({
      page: p.reader.page, state: p.reader.status, rows: p.candidates.length,
      claims: p.claims.map(c => c.type === "printed_total" ? { type: c.type, raw: c.amount.raw }
        : { type: c.type, raw: c.count.raw, qualifier: c.qualifier }),
      context: p.context.map(c => c.sourceText), diagnostics: p.diagnostics,
    })) }, null, 2));
    if (outputDirectory) await writeFile(join(outputDirectory, `${file}.json`), JSON.stringify(pages, null, 2));
  }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
