// SPDX-License-Identifier: GPL-3.0-or-later

import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(clientRoot, "..", "..")
const output = resolve(repositoryRoot, "dist", "site", "babylon")
const experimentalStellar = process.argv.includes("--experimental-stellar")

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(resolve(clientRoot, "public"), output, { recursive: true })
await cp(resolve(repositoryRoot, "content", "chapters", "origin.json"), resolve(output, "origin.json"))
if (experimentalStellar) {
  await cp(resolve(repositoryRoot, "content", "stellar", "presets", "first-light.json"), resolve(output, "stellar.json"))
} else {
  await Promise.all([
    rm(resolve(output, "stellar.html"), { force: true }),
    rm(resolve(output, "stellar.css"), { force: true }),
  ])
}

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

const originResult = await buildEntry("app.mjs", "app.js")
const stellarResult = experimentalStellar ? await buildEntry("stellar-app.mjs", "stellar-app.js") : undefined

const results = stellarResult ? [originResult, stellarResult] : [originResult]
const bytes = results
  .flatMap((result) => Object.values(result.metafile.outputs))
  .reduce((total, entry) => total + entry.bytes, 0)
const entries = experimentalStellar ? ["app.js", "stellar-app.js"] : ["app.js"]
await writeFile(resolve(output, "build.json"), JSON.stringify({
  client: "@evolution-sandbox/web-babylon",
  schema: 1,
  bundleBytes: bytes,
  entries,
  experimentalStellar,
}, null, 2) + "\n", "utf8")
console.log(`Babylon ${experimentalStellar ? "experimental clients" : "public client"} built at dist/site/babylon (${Math.ceil(bytes / 1024)} KiB total)`)
