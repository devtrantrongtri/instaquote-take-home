import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readPdfPages } from "../lib/pdf/read-pages";

async function main() {
  const dataDirectory = resolve("data");
  const outputDirectory = process.argv[2];
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });

  for (const file of (await readdir(dataDirectory)).filter((name) => name.endsWith(".pdf")).sort()) {
    const result = await readPdfPages(await readFile(join(dataDirectory, file)));
    console.log(JSON.stringify({
      file,
      pageCount: result.pageCount,
      pages: result.pages.map((page) => ({
        page: page.page,
        status: page.status,
        ...(page.status === "failed" ? { error: page.error } : {
          fragments: page.fragments.length,
          textLength: page.text.length,
        }),
      })),
    }));
    if (outputDirectory) {
      await writeFile(join(outputDirectory, `${file}.json`), JSON.stringify(result, null, 2));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
