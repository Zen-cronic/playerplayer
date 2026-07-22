// esbuild strips module-level "use client" directives when bundling, so the
// bundled entry loses the boundary marker every source file carried. Re-assert
// it once at the top of the built entry — a Server Component importing this
// package (e.g. the dashboard drill-in) needs it to be a client module.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(dir, "..", "dist", "index.js");
const directive = '"use client";\n';

const src = await readFile(entry, "utf8");
if (!src.startsWith('"use client"') && !src.startsWith("'use client'")) {
  await writeFile(entry, directive + src);
  console.log('prepended "use client" → dist/index.js');
} else {
  console.log('"use client" already present → dist/index.js');
}
