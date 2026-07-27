// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const [html, styles, result] = await Promise.all([
  readFile(resolve(clientRoot, "public", "civilization.html"), "utf8"),
  readFile(resolve(clientRoot, "public", "civilization.css"), "utf8"),
  build({
    entryPoints: [resolve(clientRoot, "src", "civilization-app.mjs")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    treeShaking: true,
    legalComments: "eof",
    write: false,
    metafile: true,
    define: { "process.env.NODE_ENV": '"production"' },
  }),
])
if (!html.includes('src="civilization-app.js"') || !html.includes('href="civilization.css"')) {
  throw new Error("Experimental civilization page does not reference its private bundle and stylesheet")
}
for (const marker of [
  "civilization-run", "civilization-step", "civilization-advance", "civilization-speed",
  "timeline-select", "comparison-select", "experiment-form", "experiment-confirm",
  "experiment-discard", "causal-status", "game-options",
]) {
  if (!html.includes(`id="${marker}"`)) throw new Error(`Experimental civilization page is missing ${marker}`)
}
if (!styles.includes(".civilization-stage") || !styles.includes(".civilization-timeline-panel")) {
  throw new Error("Experimental civilization stylesheet is incomplete")
}
const bytes = Object.values(result.metafile.outputs).reduce((total, entry) => total + entry.bytes, 0)
if (bytes >= 4 * 1024 * 1024) throw new Error(`Experimental civilization bundle is ${bytes} bytes; expected less than 4 MiB`)
console.log(`Experimental civilization observatory verified without publishing output (${Math.ceil(bytes / 1024)} KiB)`)
