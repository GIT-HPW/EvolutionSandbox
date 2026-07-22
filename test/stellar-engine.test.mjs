// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  advanceStellarSystem,
  createStellarSystem,
  formatStellarMetric,
  runStellarSystem,
  StellarController,
  StellarError,
  validateStellarSpec,
} from "../src/stellar/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const spec = JSON.parse(await readFile(resolve(root, "content", "stellar", "presets", "first-light.json"), "utf8"))

test("first-light preset is valid and records its canonical source", () => {
  const normalized = validateStellarSpec(spec)
  assert.equal(normalized.id, "first_light")
  assert.equal(normalized.source.chapter, "第1章 第5篇 星辰：物质的熔炉")
})

test("stellar application metrics expose consistent physical display units", () => {
  assert.deepEqual(formatStellarMetric("stellarMass", 170), {
    label: "星体质量", unit: "M☉", value: 170, text: "170 M☉",
  })
  assert.equal(formatStellarMetric("temperature", 110).text, "110 MK")
  assert.equal(formatStellarMetric("luminosity", 65).text, "65 万 L☉")
  assert.equal(formatStellarMetric("diskStability", 100).text, "100 %")
  assert.throws(() => formatStellarMetric("unknown", 1), TypeError)
})

test("stellar lifecycle deterministically reaches a stable planetary disk", () => {
  const first = runStellarSystem(spec)
  const second = runStellarSystem(spec)
  assert.deepEqual(first, second)
  assert.equal(first.state.status, "completed")
  assert.equal(first.state.phase, "planetary_disk")
  assert.equal(first.state.tick, 78)
  assert.equal(first.state.diskStability, 100)
  assert.ok(first.state.milestones.some((entry) => entry.id === "star_ignited"))
  assert.ok(first.state.milestones.some((entry) => entry.id === "supernova"))
  assert.equal(first.events.filter((event) => event.type === "stellar_explosion").length, 1)
  assert.equal(first.state.historyHash, "978f31f2")
})

test("a full run equals chunked deterministic replay and conserves modeled mass", () => {
  const direct = runStellarSystem(spec)
  const initial = createStellarSystem(spec)
  const first = advanceStellarSystem(spec, initial, 20)
  const second = advanceStellarSystem(spec, first.state, 200)
  assert.deepEqual(second.state, direct.state)
  assert.deepEqual([...first.events, ...second.events], direct.events)
  assert.equal(
    direct.state.nebulaMass + direct.state.stellarMass + direct.state.expelledMatter,
    spec.origin.nebulaMass + spec.origin.stellarMass,
  )
})

test("stellar controller owns pause, speed, pulses and optimistic revision", () => {
  const controller = new StellarController(spec)
  assert.equal(controller.snapshot().control.mode, "paused")
  controller.control("set_speed", { speed: 4, expectedRevision: 0 })
  controller.control("resume", { expectedRevision: 1 })
  const pulse = controller.pulse({ expectedRevision: 2 })
  assert.equal(pulse.state.tick, 4)
  controller.control("pause", { expectedRevision: 3 })
  controller.control("step", { expectedRevision: 4 })
  assert.equal(controller.snapshot().state.tick, 5)
  assert.throws(() => controller.advance(1, { expectedRevision: 4 }), (error) => error.code === "revision_conflict")
})

test("controller records restore only after deterministic genesis replay", () => {
  const controller = new StellarController(spec)
  controller.advance(40)
  const record = controller.exportRecord()
  assert.deepEqual(StellarController.restore(spec, record).snapshot(), controller.snapshot())
  record.state.temperature += 1
  assert.throws(() => StellarController.restore(spec, record), (error) => error.code === "replay_mismatch")
})

test("a completed controller pauses and cannot be resumed", () => {
  const controller = new StellarController(spec)
  controller.advance(spec.stopConditions.maxTicks)
  assert.equal(controller.snapshot().state.status, "completed")
  assert.equal(controller.snapshot().control.mode, "paused")
  assert.throws(() => controller.control("resume"), (error) => error.code === "stellar_stopped")
})

test("invalid stellar ownership and excessive batches fail closed", () => {
  assert.throws(() => validateStellarSpec({ ...spec, unexpected: true }), (error) => error instanceof StellarError)
  const state = createStellarSystem(spec)
  assert.throws(() => advanceStellarSystem(spec, { ...state, specId: "other" }, 1), (error) => error.code === "stellar_conflict")
  assert.throws(() => advanceStellarSystem(spec, state, 10001), (error) => error.code === "invalid_advance")
})
