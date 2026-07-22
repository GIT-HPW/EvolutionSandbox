// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { firstRealmMission } from "../src/progression.mjs"
import { stellarJourney } from "../src/stellar-progression.mjs"

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
  assert.doesNotMatch(html, /stellar\.html/)
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
  const built = JSON.parse(buildInfo)
  assert.equal(built.client, "@evolution-sandbox/web-babylon")
  assert.deepEqual(built.entries, ["app.js"])
  assert.equal(built.experimentalStellar, false)
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

test("experimental stellar sources are validated without entering the public preview", async () => {
  const [html, styles, source, scene, pack] = await Promise.all([
    readFile(resolve(clientRoot, "public", "stellar.html"), "utf8"),
    readFile(resolve(clientRoot, "public", "stellar.css"), "utf8"),
    readFile(resolve(clientRoot, "src", "stellar-app.mjs"), "utf8"),
    readFile(resolve(clientRoot, "src", "stellar-scene.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "content", "stellar", "presets", "first-light.json"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /src="stellar-app\.js"/)
  assert.match(html, /id="stellar-run"/)
  assert.match(html, /id="stellar-transition"/)
  assert.match(html, /href="stellar\.css"/)
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i)
  assert.match(styles, /\.stellar-stage/)
  assert.match(source, /StellarController/)
  assert.match(source, /controller\.pulse/)
  assert.match(source, /expectedRevision/)
  assert.match(source, /StellarController\.restore/)
  assert.doesNotMatch(source, /state\.(nebulaMass|stellarMass|corePressure|temperature|luminosity|stability|fuel|elementDiversity|expelledMatter|diskMass|diskStability)\s*[+\-*/]?=/)
  assert.doesNotMatch(scene, /https?:\/\//)
  const content = JSON.parse(pack)
  assert.equal(content.id, "first_light")
  assert.equal(content.source.chapter, "第1章 第5篇 星辰：物质的熔炉")
  for (const name of ["stellar.html", "stellar.css", "stellar-app.js", "stellar.json"]) {
    await assert.rejects(readFile(resolve(output, name), "utf8"), (error) => error.code === "ENOENT")
  }
})

test("stellar journey reads only confirmed milestone and completion state", () => {
  const pending = stellarJourney({
    status: "running",
    milestones: [{ id: "nebula_formed", tick: 0 }, { id: "protostar_formed", tick: 5 }],
  })
  assert.equal(pending.completed, 1)
  assert.equal(pending.complete, false)
  const complete = stellarJourney({
    status: "completed",
    milestones: [
      { id: "nebula_formed", tick: 0 },
      { id: "protostar_formed", tick: 5 },
      { id: "star_ignited", tick: 16 },
      { id: "main_sequence_completed", tick: 45 },
      { id: "supernova", tick: 57 },
      { id: "planetary_disk", tick: 58 },
    ],
  })
  assert.equal(complete.completed, 5)
  assert.equal(complete.complete, true)
})

test("Babylon vertical slice stays within its initial JavaScript bundle budget", async () => {
  const bundle = await stat(resolve(output, "app.js"))
  assert.ok(bundle.size < 4 * 1024 * 1024, `app.js is ${bundle.size} bytes; expected less than 4 MiB`)
})
