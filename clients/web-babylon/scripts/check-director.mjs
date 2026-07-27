// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const [html, styles, result] = await Promise.all([
  readFile(resolve(clientRoot, "public", "origin-director.html"), "utf8"),
  readFile(resolve(clientRoot, "public", "director.css"), "utf8"),
  build({
    entryPoints: [resolve(clientRoot, "src", "director-app.mjs")],
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
if (!html.includes('src="director-app.js"') || !html.includes('href="director.css"')) {
  throw new Error("Experimental director page does not reference its private bundle and stylesheet")
}
for (const marker of ["director-goal-form", "director-approve", "director-decline", "director-reset", "full-auto"]) {
  if (!html.includes(`id="${marker}"`)) throw new Error(`Experimental director page is missing ${marker}`)
}
if (!styles.includes(".director-overlay") || !styles.includes(".director-ticket")) {
  throw new Error("Experimental director stylesheet is incomplete")
}
const bytes = Object.values(result.metafile.outputs).reduce((total, entry) => total + entry.bytes, 0)
if (bytes >= 4 * 1024 * 1024) throw new Error(`Experimental director bundle is ${bytes} bytes; expected less than 4 MiB`)
console.log(`Experimental director client verified without publishing output (${Math.ceil(bytes / 1024)} KiB)`)
