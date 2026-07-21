// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { firstRealmMission } from "../src/progression.mjs"

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
  assert.match(html, /id="mission-panel"/)
  assert.match(html, /id="realm-transition"/)
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.match(styles, /prefers-reduced-motion/)
  assert.match(styles, /@keyframes transition-rift/)
  assert.match(source, /createBrowserEvolutionAdapter/)
  assert.match(source, /TYPES\.ACTION_REQUESTED/)
  assert.match(source, /expectedRevision: revision/)
  assert.match(source, /DEFAULT_BROWSER_STORAGE_KEY/)
  assert.match(source, /firstRealmMission/)
  assert.doesNotMatch(source, /state\.(energy|information|entropy|stability|fragments|matter|matterCreated|matterStabilized|matterRecycled)\s*[+\-*/]?=/)
  assert.ok(bundle.length > 100_000, "Babylon engine should be bundled locally")
  const content = JSON.parse(pack)
  assert.equal(content.id, "evolution.origin")
  assert.equal(content.initialState.matter, 0)
  assert.equal(content.actions.destroy.requires.matter, 1)
  assert.equal(JSON.parse(buildInfo).client, "@evolution-sandbox/web-babylon")
})

test("first realm mission is derived only from confirmed state milestones", () => {
  const pending = firstRealmMission({
    phase: "first_3d", matterCreated: 1, matterStabilized: 0, matterRecycled: 0,
  })
  assert.equal(pending.completed, 1)
  assert.equal(pending.complete, false)
  const completed = firstRealmMission({
    phase: "first_3d", matterCreated: 1, matterStabilized: 1, matterRecycled: 1,
  })
  assert.equal(completed.complete, true)
  assert.deepEqual(completed.steps.map((step) => step.complete), [true, true, true])
})

test("Babylon vertical slice stays within its initial JavaScript bundle budget", async () => {
  const bundle = await stat(resolve(output, "app.js"))
  assert.ok(bundle.size < 4 * 1024 * 1024, `Babylon bundle is ${bundle.size} bytes; expected less than 4 MiB`)
})
