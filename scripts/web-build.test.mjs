// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const site = resolve(root, "dist", "site")

test("browser build is self-contained and uses the shared rules engine through ESIP", async () => {
  const [html, app, scene, packText, styles, envelopeSchema, asyncApi, browserAdapter, router] = await Promise.all([
    readFile(resolve(site, "index.html"), "utf8"),
    readFile(resolve(site, "app.mjs"), "utf8"),
    readFile(resolve(site, "scene.mjs"), "utf8"),
    readFile(resolve(site, "origin.json"), "utf8"),
    readFile(resolve(site, "styles.css"), "utf8"),
    readFile(resolve(site, "esip", "schemas", "envelope.schema.json"), "utf8"),
    readFile(resolve(site, "esip", "asyncapi.json"), "utf8"),
    readFile(resolve(site, "interop", "browser-game-adapter.mjs"), "utf8"),
    readFile(resolve(site, "interop", "router.mjs"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'self'/)
  assert.match(html, /href="(?:\.\/)?babylon\/"/)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.match(app, /from "\.\/rules-engine\.mjs"/)
  assert.match(app, /fetch\("\.\/origin\.json"\)/)
  assert.match(app, /createBrowserEvolutionAdapter/)
  assert.match(app, /createEvolutionScene/)
  assert.match(app, /TYPES\.ACTION_REQUESTED/)
  assert.match(app, /setActionFeedback/)
  assert.match(app, /addNarrative/)
  assert.match(app, /aria-disabled/)
  assert.doesNotMatch(app, /button\.disabled = busy \|\|/)
  assert.match(html, /id="universe-scene"/)
  assert.match(html, /class="experience-layout"/)
  assert.match(html, /class="action-panel"/)
  assert.match(html, /id="action-feedback"/)
  assert.match(html, /id="narrative-stream"/)
  assert.match(scene, /getContext\("webgl"/)
  assert.match(scene, /requestAnimationFrame/)
  assert.match(scene, /prefers-reduced-motion/)
  assert.match(styles, /\.scene-fallback/)
  assert.match(styles, /\.experience-layout[\s\S]*grid-template-columns/)
  assert.match(styles, /\.action-panel[\s\S]*position: sticky/)
  assert.doesNotMatch(scene, /https?:\/\//)
  assert.match(browserAdapter, /DEFAULT_BROWSER_STORAGE_KEY/)
  assert.doesNotMatch(browserAdapter + router, /from "node:/)
  assert.equal(JSON.parse(envelopeSchema).properties.esipversion.const, "0.1")
  assert.equal(JSON.parse(asyncApi).asyncapi, "3.0.0")

  const engine = await import(pathToFileURL(resolve(site, "rules-engine.mjs")))
  const sceneModule = await import(pathToFileURL(resolve(site, "scene.mjs")))
  assert.equal(sceneModule.createEvolutionScene(null).supported, false)
  const pack = engine.validatePack(JSON.parse(packText))
  let state = engine.createState(pack)
  for (const action of pack.demo) state = engine.applyAction(pack, state, action).state
  assert.equal(state.phase, "first_3d")
})
