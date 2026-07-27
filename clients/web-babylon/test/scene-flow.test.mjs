// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { SCENE_REGISTRY, scenesForProfile } from "../config/scenes.mjs"
import {
  loadAutoEvolution,
  startAutoEvolution,
  updateAutoEvolution,
} from "../src/auto-evolution.mjs"
import { clearSceneFlow, SceneFlowController, SceneFlowError } from "../src/scene-flow.mjs"

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test("scene registry exposes experimental stages only to the explicit profile", () => {
  const publicScenes = scenesForProfile("public")
  const experimentalScenes = scenesForProfile("experimental")
  assert.deepEqual(publicScenes.map((scene) => scene.id), ["origin"])
  assert.deepEqual(experimentalScenes.map((scene) => scene.id), ["origin", "stellar", "civilization"])
  assert.equal(publicScenes[0].page, "origin.html")
  assert.equal(publicScenes[0].sourceEntry, "app.mjs")
  assert.equal(experimentalScenes[0].page, "origin-director.html")
  assert.equal(experimentalScenes[0].sourceEntry, "director-app.mjs")
  assert.deepEqual(experimentalScenes[0].styles, ["styles.css", "director.css"])
  assert.equal(SCENE_REGISTRY.find((scene) => scene.id === "stellar").visibility, "experimental")
  assert.equal(SCENE_REGISTRY.find((scene) => scene.id === "civilization").visibility, "experimental")
  assert.throws(() => scenesForProfile("unknown"), /Unknown scene profile/)
})

test("scene flow requires lobby selection, pause, checkpoint and transition in order", () => {
  const storage = memoryStorage()
  let clock = 0
  const flow = new SceneFlowController({ storage, now: () => `t-${clock++}` })
  assert.equal(flow.snapshot().state, "boot")
  flow.showStageSelect()
  flow.selectScene("origin", ["origin"])
  flow.sceneReady("origin")
  assert.equal(flow.snapshot().state, "playing")
  assert.throws(() => flow.beginCheckpoint(), (error) => error instanceof SceneFlowError && error.code === "invalid_transition")
  flow.pause()
  const refreshed = new SceneFlowController({ storage, now: () => `f-${clock++}` })
  refreshed.sceneReady("origin")
  assert.equal(refreshed.snapshot().state, "playing")
  refreshed.pause()
  refreshed.beginCheckpoint()
  refreshed.completeCheckpoint({ revision: 7, tick: 4, phase: "first_3d" })
  assert.deepEqual(refreshed.snapshot().checkpoint.metadata, { revision: 7, tick: 4, phase: "first_3d" })
  refreshed.beginMenuTransition()
  assert.equal(refreshed.snapshot().state, "transitioning")
  assert.equal(refreshed.snapshot().sceneId, null)

  const recovered = new SceneFlowController({ storage, now: () => `r-${clock++}` })
  recovered.showStageSelect()
  assert.equal(recovered.snapshot().state, "stage_select")
  assert.equal(recovered.snapshot().lastSceneId, "origin")
})

test("scene flow rejects unavailable scenes and preserves invalid records until explicit reset", () => {
  const storage = memoryStorage()
  const flow = new SceneFlowController({ storage })
  flow.showStageSelect()
  assert.throws(
    () => flow.sceneReady("origin"),
    (error) => error instanceof SceneFlowError && error.code === "scene_mismatch",
  )
  assert.throws(
    () => flow.selectScene("stellar", ["origin"]),
    (error) => error instanceof SceneFlowError && error.code === "scene_unavailable",
  )
  storage.setItem("evolution-sandbox.scene-flow.v1", "{broken")
  assert.throws(
    () => new SceneFlowController({ storage }),
    (error) => error instanceof SceneFlowError && error.code === "invalid_navigation_record",
  )
  assert.equal(storage.getItem("evolution-sandbox.scene-flow.v1"), "{broken")
  clearSceneFlow(storage)
  assert.equal(new SceneFlowController({ storage }).snapshot().state, "boot")
})

test("approved transition permits require the matching checkpoint and are consumed once", () => {
  const storage = memoryStorage()
  const flow = new SceneFlowController({ storage, now: () => "2026-07-23T00:00:00.000Z" })
  flow.showStageSelect()
  flow.selectScene("origin", ["origin", "stellar"])
  flow.sceneReady("origin")
  flow.pause()
  flow.beginCheckpoint()
  flow.completeCheckpoint({ revision: 12, tick: 10, phase: "first_3d" })
  assert.throws(
    () => flow.grantTransitionPermit({
      permitId: "permit-stale",
      fromScene: "origin",
      toScene: "stellar",
      expectedStateRevision: 11,
    }),
    (error) => error instanceof SceneFlowError && error.code === "stale_checkpoint",
  )
  flow.grantTransitionPermit({
    permitId: "permit-12",
    fromScene: "origin",
    toScene: "stellar",
    expectedStateRevision: 12,
    automatic: true,
  })
  flow.beginMenuTransition()

  const lobby = new SceneFlowController({ storage })
  lobby.showStageSelect()
  assert.deepEqual(lobby.snapshot().transitionPermit, {
    permitId: "permit-12",
    fromScene: "origin",
    toScene: "stellar",
    expectedStateRevision: 12,
    automatic: true,
    issuedAt: "2026-07-23T00:00:00.000Z",
  })
  lobby.selectScene("stellar", ["origin", "stellar"])
  assert.equal(lobby.snapshot().state, "loading")
  assert.equal(lobby.snapshot().transitionPermit, null)
})

test("scene flow explicitly migrates version 1 navigation records", () => {
  const storage = memoryStorage()
  storage.setItem("evolution-sandbox.scene-flow.v1", JSON.stringify({
    schemaVersion: 1,
    state: "stage_select",
    sceneId: null,
    lastSceneId: "origin",
    revision: 4,
    checkpoint: null,
    updatedAt: "legacy",
  }))
  const flow = new SceneFlowController({ storage })
  assert.equal(flow.snapshot().schemaVersion, 2)
  assert.equal(flow.snapshot().transitionPermit, null)
})

test("auto evolution sessions are explicit, recoverable and replaceable only by request", () => {
  const storage = memoryStorage()
  const first = startAutoEvolution({ storage, runId: "auto-1", now: () => "start" })
  assert.equal(first.status, "origin_running")
  assert.throws(() => startAutoEvolution({ storage, runId: "auto-2" }), /already active/)
  updateAutoEvolution("transitioning", { storage, runId: "auto-1", now: () => "handoff" })
  assert.equal(loadAutoEvolution(storage).status, "transitioning")
  const replacement = startAutoEvolution({ storage, runId: "auto-2", replace: true, now: () => "restart" })
  assert.equal(replacement.runId, "auto-2")
  updateAutoEvolution("completed", { storage, runId: "auto-2", now: () => "done" })
  assert.equal(loadAutoEvolution(storage).status, "completed")
})
