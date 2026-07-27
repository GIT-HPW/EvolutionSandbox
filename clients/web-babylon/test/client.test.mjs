// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile, readdir, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { firstRealmMission } from "../src/progression.mjs"
import { stellarJourney } from "../src/stellar-progression.mjs"

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = resolve(clientRoot, "..", "..")
const output = resolve(repositoryRoot, "dist", "site", "babylon")

test("Babylon client build is self-contained and keeps ESIP as the authority", async () => {
  const [lobby, html, styles, menuBundle, bundle, source, pack, sceneManifest, buildInfo] = await Promise.all([
    readFile(resolve(output, "index.html"), "utf8"),
    readFile(resolve(output, "origin.html"), "utf8"),
    readFile(resolve(output, "styles.css"), "utf8"),
    readFile(resolve(output, "menu.js"), "utf8"),
    readFile(resolve(output, "app.js"), "utf8"),
    readFile(resolve(clientRoot, "src", "app.mjs"), "utf8"),
    readFile(resolve(output, "origin.json"), "utf8"),
    readFile(resolve(output, "scenes.json"), "utf8"),
    readFile(resolve(output, "build.json"), "utf8"),
  ])
  assert.match(lobby, /src="menu\.js"/)
  assert.match(lobby, /id="stage-grid"/)
  assert.doesNotMatch(lobby, /stellar/i)
  assert.doesNotMatch(lobby, /civilization/i)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /script-src 'self'/)
  assert.match(html, /src="app\.js"/)
  assert.match(html, /id="mission-panel"/)
  assert.match(html, /id="realm-transition"/)
  assert.match(html, /id="game-options"/)
  assert.match(html, /id="options-exit"/)
  assert.doesNotMatch(html, /stellar\.html/)
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i)
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i)
  assert.match(styles, /prefers-reduced-motion/)
  assert.match(styles, /@keyframes transition-rift/)
  assert.match(styles, /\.options-overlay/)
  assert.match(menuBundle, /evolution-sandbox\.scene-flow\.v1/)
  assert.match(source, /createBrowserEvolutionAdapter/)
  assert.match(source, /TYPES\.ACTION_REQUESTED/)
  assert.match(source, /expectedRevision: revision/)
  assert.match(source, /DEFAULT_BROWSER_STORAGE_KEY/)
  assert.match(source, /firstRealmMission/)
  assert.match(source, /waitForAuthorityCommit/)
  assert.doesNotMatch(source, /state\.(energy|information|entropy|stability|fragments|matter|matterCreated|matterStabilized|matterRecycled)\s*[+\-*/]?=/)
  assert.ok(bundle.length > 100_000, "Babylon engine should be bundled locally")
  const content = JSON.parse(pack)
  assert.equal(content.id, "evolution.origin")
  assert.equal(content.initialState.matter, 0)
  assert.equal(content.actions.destroy.requires.matter, 1)
  const availableScenes = JSON.parse(sceneManifest)
  assert.equal(availableScenes.profile, "public")
  assert.deepEqual(availableScenes.scenes.map((scene) => scene.id), ["origin"])
  assert.doesNotMatch(sceneManifest, /stellar/i)
  assert.doesNotMatch(sceneManifest, /civilization/i)
  const built = JSON.parse(buildInfo)
  assert.equal(built.client, "@evolution-sandbox/web-babylon")
  assert.equal(built.schema, 2)
  assert.equal(built.profile, "public")
  assert.deepEqual(built.entries, ["menu.js", "app.js"])
  assert.deepEqual(built.scenes, ["origin"])
  assert.equal(built.experimentalStellar, false)
  assert.equal(built.experimentalCivilization, false)

  assert.deepEqual((await readdir(output)).sort(), [
    "app.js",
    "build.json",
    "index.html",
    "menu.css",
    "menu.js",
    "origin.html",
    "origin.json",
    "scenes.json",
    "styles.css",
  ])
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
  assert.match(html, /id="game-options"/)
  assert.match(html, /id="options-exit"/)
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

test("local director lab is isolated from the public build and keeps manual approval in front of authority", async () => {
  const [html, styles, source, approval, publicHtml, publicBundle] = await Promise.all([
    readFile(resolve(clientRoot, "public", "origin-director.html"), "utf8"),
    readFile(resolve(clientRoot, "public", "director.css"), "utf8"),
    readFile(resolve(clientRoot, "src", "director-app.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "src", "director", "approval.mjs"), "utf8"),
    readFile(resolve(output, "origin.html"), "utf8"),
    readFile(resolve(output, "app.js"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /src="director-app\.js"/)
  assert.match(html, /href="director\.css"/)
  assert.match(html, /id="director-goal-form"/)
  assert.match(html, /id="director-approve"/)
  assert.match(html, /id="director-decline"/)
  assert.match(html, /id="full-auto"/)
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i)
  assert.match(styles, /\.director-overlay/)
  assert.match(source, /createDirectorAdapter/)
  assert.match(source, /createDirectorApprovalGate/)
  assert.match(source, /runtime\.executeApprovedAction/)
  assert.match(source, /gate\.review/)
  assert.match(source, /runtime\.runFullEvolution/)
  assert.match(source, /runtime\.completeSceneTransition/)
  assert.doesNotMatch(publicHtml, /id="full-auto"/)
  assert.match(source, /navigationPerformed: false/)
  assert.match(approval, /stale_observation/)
  assert.match(approval, /reconciliation_required/)
  assert.doesNotMatch(publicHtml + publicBundle, /AI 导演控制台|evolution-sandbox\.director\.record\.v1|director-goal-form/)
  for (const name of ["origin-director.html", "director.css", "director-app.js"]) {
    await assert.rejects(readFile(resolve(output, name), "utf8"), (error) => error.code === "ENOENT")
  }
})

test("civilization observatory consumes WorldObservation and stays outside the public build", async () => {
  const [html, styles, source, consumer, scene, pack] = await Promise.all([
    readFile(resolve(clientRoot, "public", "civilization.html"), "utf8"),
    readFile(resolve(clientRoot, "public", "civilization.css"), "utf8"),
    readFile(resolve(clientRoot, "src", "civilization-app.mjs"), "utf8"),
    readFile(resolve(clientRoot, "src", "civilization-observatory.mjs"), "utf8"),
    readFile(resolve(clientRoot, "src", "civilization-scene.mjs"), "utf8"),
    readFile(resolve(repositoryRoot, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"),
  ])
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /src="civilization-app\.js"/)
  assert.match(html, /href="civilization\.css"/)
  assert.match(html, /id="timeline-select"/)
  assert.match(html, /id="comparison-select"/)
  assert.match(html, /id="experiment-form"/)
  assert.match(html, /id="experiment-confirm"/)
  assert.match(html, /id="experiment-discard"/)
  assert.match(html, /id="civilization-run"/)
  assert.match(html, /id="game-options"/)
  assert.doesNotMatch(html, /<(script|link)[^>]+https?:\/\//i)
  assert.match(styles, /\.civilization-stage/)
  assert.match(styles, /\.experiment-review/)
  assert.match(source, /CivilizationObservatory/)
  assert.match(source, /observatory\.observe\(\)/)
  assert.match(source, /observatory\.compare/)
  assert.match(source, /observatory\.proposeExperiment/)
  assert.match(source, /observatory\.commitExperiment/)
  assert.doesNotMatch(source, /CivilizationController/)
  assert.doesNotMatch(source, /state\.(population|resources|knowledge|ecology|cohesion)\s*[+\-*/]?=/)
  assert.match(consumer, /createCivilizationObservation/)
  assert.match(consumer, /WorldObservationRegistry/)
  assert.match(consumer, /createWorldExperimentProposal/)
  assert.match(scene, /setObservation/)
  assert.doesNotMatch(scene, /CivilizationController/)
  assert.equal(JSON.parse(pack).id, "tidal_archive")
  for (const name of ["civilization.html", "civilization.css", "civilization-app.js", "civilization.json"]) {
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
