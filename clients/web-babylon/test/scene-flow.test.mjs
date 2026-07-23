// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { SCENE_REGISTRY, scenesForProfile } from "../config/scenes.mjs"
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
  assert.deepEqual(scenesForProfile("public").map((scene) => scene.id), ["origin"])
  assert.deepEqual(scenesForProfile("experimental").map((scene) => scene.id), ["origin", "stellar"])
  assert.equal(SCENE_REGISTRY.find((scene) => scene.id === "stellar").visibility, "experimental")
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
