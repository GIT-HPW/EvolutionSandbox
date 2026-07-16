// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const site = resolve(root, "dist", "site")

test("browser build is self-contained and uses the shared rules engine", async () => {
  const [html, app, packText] = await Promise.all([
    readFile(resolve(site, "index.html"), "utf8"),
    readFile(resolve(site, "app.mjs"), "utf8"),
    readFile(resolve(site, "origin.json"), "utf8"),
    readFile(resolve(site, "styles.css"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'self'/)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.match(app, /from "\.\/rules-engine\.mjs"/)
  assert.match(app, /fetch\("\.\/origin\.json"\)/)

  const engine = await import(pathToFileURL(resolve(site, "rules-engine.mjs")))
  const pack = engine.validatePack(JSON.parse(packText))
  let state = engine.createState(pack)
  for (const action of pack.demo) state = engine.applyAction(pack, state, action).state
  assert.equal(state.phase, "first_3d")
})
