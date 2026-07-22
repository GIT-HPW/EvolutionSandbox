// SPDX-License-Identifier: GPL-3.0-or-later

import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(clientRoot, "..", "..")
const output = resolve(repositoryRoot, "dist", "site", "babylon")

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(resolve(clientRoot, "public"), output, { recursive: true })
await cp(resolve(repositoryRoot, "content", "chapters", "origin.json"), resolve(output, "origin.json"))
await cp(resolve(repositoryRoot, "content", "stellar", "presets", "first-light.json"), resolve(output, "stellar.json"))

async function buildEntry(entry, outfile) {
  return build({
    entryPoints: [resolve(clientRoot, "src", entry)],
    outfile: resolve(output, outfile),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    treeShaking: true,
    legalComments: "eof",
    metafile: true,
    define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: "// SPDX-License-Identifier: GPL-3.0-or-later" },
  })
}

const [originResult, stellarResult] = await Promise.all([
  buildEntry("app.mjs", "app.js"),
  buildEntry("stellar-app.mjs", "stellar-app.js"),
])

const bytes = [originResult, stellarResult]
  .flatMap((result) => Object.values(result.metafile.outputs))
  .reduce((total, entry) => total + entry.bytes, 0)
await writeFile(resolve(output, "build.json"), JSON.stringify({
  client: "@evolution-sandbox/web-babylon",
  schema: 1,
  bundleBytes: bytes,
  entries: ["app.js", "stellar-app.js"],
}, null, 2) + "\n", "utf8")
console.log(`Babylon clients built at dist/site/babylon (${Math.ceil(bytes / 1024)} KiB total)`)
