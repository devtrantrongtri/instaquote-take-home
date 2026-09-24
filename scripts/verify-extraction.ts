import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractDocument } from "../lib/extract-document";

async function main() {
  const outputDirectory = process.argv[2];
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  for (const file of (await readdir("data")).filter(f => f.endsWith(".pdf")).sort()) {
    const result = await extractDocument(await readFile(join("data", file)));
    console.log(JSON.stringify({ file, items: result.items.length,
      pages: [...new Set(result.items.map(item => item.evidence[0].page))],
      refusals: result.refusals, issues: result.issues.map(({ evidence, ...issue }) => ({ ...issue, evidenceQuotes: evidence?.length ?? 0 })) }, null, 2));
    if (outputDirectory) await writeFile(join(outputDirectory, `${file}.json`), JSON.stringify(result, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
