// SPDX-License-Identifier: GPL-3.0-or-later

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { publicSceneDescriptor, scenesForProfile } from "../config/scenes.mjs"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(clientRoot, "..", "..")
const output = resolve(repositoryRoot, "dist", "site", "babylon")
const experimentalStellar = process.argv.includes("--experimental-stellar")
const profile = experimentalStellar ? "experimental" : "public"
const scenes = scenesForProfile(profile)

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await Promise.all([
  copyFile(resolve(clientRoot, "public", "index.html"), resolve(output, "index.html")),
  copyFile(resolve(clientRoot, "public", "menu.css"), resolve(output, "menu.css")),
])

const copiedStyles = new Set()
for (const scene of scenes) {
  await copyFile(resolve(clientRoot, "public", scene.page), resolve(output, scene.page))
  for (const stylesheet of scene.styles) {
    if (copiedStyles.has(stylesheet)) continue
    await copyFile(resolve(clientRoot, "public", stylesheet), resolve(output, stylesheet))
    copiedStyles.add(stylesheet)
  }
  for (const content of scene.content) {
    await copyFile(resolve(repositoryRoot, content.source), resolve(output, content.output))
  }
}

await writeFile(resolve(output, "scenes.json"), JSON.stringify({
  schemaVersion: 1,
  profile,
  scenes: scenes.map(publicSceneDescriptor),
}, null, 2) + "\n", "utf8")

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

const menuResult = await buildEntry("menu.mjs", "menu.js")
const sceneResults = []
for (const scene of scenes) sceneResults.push(await buildEntry(scene.sourceEntry, scene.bundle))
const results = [menuResult, ...sceneResults]
const bytes = results
  .flatMap((result) => Object.values(result.metafile.outputs))
  .reduce((total, entry) => total + entry.bytes, 0)
const entries = ["menu.js", ...scenes.map((scene) => scene.bundle)]
await writeFile(resolve(output, "build.json"), JSON.stringify({
  client: "@evolution-sandbox/web-babylon",
  schema: 2,
  profile,
  bundleBytes: bytes,
  entries,
  scenes: scenes.map((scene) => scene.id),
  experimentalStellar,
}, null, 2) + "\n", "utf8")
console.log(`Babylon ${profile} scene lobby built at dist/site/babylon (${Math.ceil(bytes / 1024)} KiB total)`)
