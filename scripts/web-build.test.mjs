// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const site = resolve(root, "dist", "site")

test("browser build is self-contained and uses the shared rules engine through ESIP", async () => {
  const [html, app, packText, _styles, envelopeSchema, asyncApi, browserAdapter, router] = await Promise.all([
    readFile(resolve(site, "index.html"), "utf8"),
    readFile(resolve(site, "app.mjs"), "utf8"),
    readFile(resolve(site, "origin.json"), "utf8"),
    readFile(resolve(site, "styles.css"), "utf8"),
    readFile(resolve(site, "esip", "schemas", "envelope.schema.json"), "utf8"),
    readFile(resolve(site, "esip", "asyncapi.json"), "utf8"),
    readFile(resolve(site, "interop", "browser-game-adapter.mjs"), "utf8"),
    readFile(resolve(site, "interop", "router.mjs"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'self'/)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.match(app, /from "\.\/rules-engine\.mjs"/)
  assert.match(app, /fetch\("\.\/origin\.json"\)/)
  assert.match(app, /createBrowserEvolutionAdapter/)
  assert.match(app, /TYPES\.ACTION_REQUESTED/)
  assert.match(browserAdapter, /DEFAULT_BROWSER_STORAGE_KEY/)
  assert.doesNotMatch(browserAdapter + router, /from "node:/)
  assert.equal(JSON.parse(envelopeSchema).properties.esipversion.const, "0.1")
  assert.equal(JSON.parse(asyncApi).asyncapi, "3.0.0")

  const engine = await import(pathToFileURL(resolve(site, "rules-engine.mjs")))
  const pack = engine.validatePack(JSON.parse(packText))
  let state = engine.createState(pack)
  for (const action of pack.demo) state = engine.applyAction(pack, state, action).state
  assert.equal(state.phase, "first_3d")
})
