// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(clientRoot, "..", "..")
const output = resolve(repositoryRoot, "dist", "site", "babylon")

test("Babylon client build is self-contained and keeps ESIP as the authority", async () => {
  const [html, styles, bundle, source, pack, buildInfo] = await Promise.all([
    readFile(resolve(output, "index.html"), "utf8"),
    readFile(resolve(output, "styles.css"), "utf8"),
    readFile(resolve(output, "app.js"), "utf8"),
    readFile(resolve(clientRoot, "src", "app.mjs"), "utf8"),
    readFile(resolve(output, "origin.json"), "utf8"),
    readFile(resolve(output, "build.json"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'self'/)
  assert.match(html, /src="app\.js"/)
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.match(styles, /prefers-reduced-motion/)
  assert.match(source, /createBrowserEvolutionAdapter/)
  assert.match(source, /TYPES\.ACTION_REQUESTED/)
  assert.match(source, /expectedRevision: revision/)
  assert.match(source, /DEFAULT_BROWSER_STORAGE_KEY/)
  assert.doesNotMatch(source, /state\.(energy|information|entropy|stability|fragments)\s*[+\-*/]?=/)
  assert.ok(bundle.length > 100_000, "Babylon engine should be bundled locally")
  assert.equal(JSON.parse(pack).id, "evolution.origin")
  assert.equal(JSON.parse(buildInfo).client, "@evolution-sandbox/web-babylon")
})

test("Babylon vertical slice stays within its initial JavaScript bundle budget", async () => {
  const bundle = await stat(resolve(output, "app.js"))
  assert.ok(bundle.size < 4 * 1024 * 1024, `Babylon bundle is ${bundle.size} bytes; expected less than 4 MiB`)
})
