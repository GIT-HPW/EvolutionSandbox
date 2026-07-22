// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  CivilizationController,
  CivilizationError,
  createCivilization,
  hashHex,
  replayCivilization,
  validateCivilizationCheckpoint,
} from "../src/civilization/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tidal = JSON.parse(await readFile(resolve(root, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"))

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function rehashCheckpoint(checkpoint) {
  const { checkpointHash: ignored, ...core } = checkpoint
  checkpoint.checkpointHash = hashHex(JSON.stringify(canonicalize(core)))
}

test("controller advances in deterministic chunks and records exact interval checkpoints", () => {
  const controller = new CivilizationController(tidal, { snapshotInterval: 100 })
  assert.equal(controller.snapshot().control.mode, "paused")
  const result = controller.advance(250, { expectedRevision: 0 })
  const record = controller.exportRecord()

  assert.equal(result.state.tick, 250)
  assert.deepEqual(record.timelines[0].checkpoints.map((entry) => entry.tick), [0, 100, 200])
  assert.deepEqual(CivilizationController.restore(tidal, record).snapshot(), controller.snapshot())
})

test("pause, speed, pulse and step use optimistic revision checks", () => {
  const controller = new CivilizationController(tidal)
  controller.control("set_speed", { speed: 16, expectedRevision: 0 })
  controller.control("resume", { expectedRevision: 1 })
  const pulse = controller.pulse({ expectedRevision: 2 })
  assert.equal(pulse.state.tick, 16)
  assert.throws(() => controller.control("step", { expectedRevision: 3 }), (error) => error.code === "invalid_control")
  controller.control("pause", { expectedRevision: 3 })
  controller.control("step", { expectedRevision: 4 })
  assert.equal(controller.snapshot().state.tick, 17)
  assert.throws(() => controller.advance(1, { expectedRevision: 4 }), (error) => error.code === "revision_conflict")
})

test("historical branches replay from a checkpoint without rewinding their parent", () => {
  const controller = new CivilizationController(tidal, { timelineId: "main", snapshotInterval: 100 })
  controller.advance(300)
  const parentBefore = controller.snapshot().state
  const branch = controller.branch("ecology-path", { atTick: 150, expectedRevision: 1 })

  assert.equal(branch.state.tick, 150)
  assert.equal(branch.state.historyHash, controller.exportRecord().timelines[1].branchHistoryHash)
  controller.advance(25, { expectedRevision: 2 })
  assert.equal(controller.snapshot().state.tick, 175)
  controller.switchTimeline("main", { expectedRevision: 3 })
  assert.deepEqual(controller.snapshot().state, parentBefore)

  const restored = CivilizationController.restore(tidal, controller.exportRecord())
  assert.deepEqual(restored.snapshot(), controller.snapshot())
})

test("checkpoint verification rejects altered state and replay rejects unreachable ticks", () => {
  const controller = new CivilizationController(tidal, { snapshotInterval: 100 })
  controller.advance(100)
  const checkpoint = controller.exportRecord().timelines[0].checkpoints.at(-1)
  assert.equal(replayCivilization(tidal, checkpoint, 125).state.tick, 125)

  const altered = structuredClone(checkpoint)
  altered.state.resources += 1
  assert.throws(() => validateCivilizationCheckpoint(tidal, altered), (error) => error.code === "checkpoint_corrupt")

  const shortSpec = structuredClone(tidal)
  shortSpec.id = "short_lived"
  shortSpec.stopConditions.maxTicks = 1
  shortSpec.autonomy.strategyInterval = 1
  const short = new CivilizationController(shortSpec, { snapshotInterval: 10 })
  short.advance(1)
  const terminal = short.exportRecord().timelines[0].checkpoints.at(-1)
  assert.equal(terminal.tick, 1)
  assert.equal(terminal.state.status, "completed")
})

test("restoration verifies deterministic checkpoint chains and branch provenance", () => {
  const controller = new CivilizationController(tidal, { snapshotInterval: 50 })
  controller.advance(120)
  controller.branch("counterfactual", { atTick: 75 })
  const record = controller.exportRecord()
  const altered = structuredClone(record)
  altered.timelines[0].checkpoints[1].state.resources += 1
  assert.throws(() => CivilizationController.restore(tidal, altered), (error) => error instanceof CivilizationError)

  const forgedGenesis = new CivilizationController(tidal).exportRecord()
  const forgedRoot = forgedGenesis.timelines[0]
  forgedRoot.state.historyHash = "00000000"
  forgedRoot.branchHistoryHash = "00000000"
  forgedRoot.checkpoints[0].historyHash = "00000000"
  forgedRoot.checkpoints[0].state.historyHash = "00000000"
  rehashCheckpoint(forgedRoot.checkpoints[0])
  assert.throws(
    () => CivilizationController.restore(tidal, forgedGenesis),
    (error) => error.code === "replay_mismatch" && error.message.includes("genesis"),
  )

  const genesis = createCivilization(tidal)
  assert.equal(record.timelines[0].checkpoints[0].historyHash, genesis.historyHash)
})
