// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  advanceCivilization,
  CivilizationError,
  createCivilization,
  nextUint32,
  runCivilization,
  seedToState,
  validateCivilizationSpec,
} from "../src/civilization/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const presetDirectory = resolve(root, "content", "civilizations", "presets")
const presetFiles = (await readdir(presetDirectory)).filter((name) => name.endsWith(".json")).sort()
const presets = await Promise.all(presetFiles.map(async (file) => JSON.parse(await readFile(resolve(presetDirectory, file), "utf8"))))
const tidal = presets.find((preset) => preset.id === "tidal_archive")
const ember = presets.find((preset) => preset.id === "ember_steppe")

test("civilization presets are structurally valid and independently seeded", () => {
  assert.equal(presets.length, 3)
  assert.equal(new Set(presets.map((preset) => validateCivilizationSpec(preset).id)).size, presets.length)
  assert.equal(new Set(presets.map((preset) => preset.seed)).size, presets.length)
})

test("seeded PRNG has a stable non-zero sequence", () => {
  const initial = seedToState("civ-tidal-001")
  const first = nextUint32(initial)
  const second = nextUint32(first.state)
  assert.ok(initial > 0)
  assert.equal(first.state, first.value)
  assert.notEqual(first.value, second.value)
})

test("one 1000-tick run equals a 100+900 tick replay", () => {
  const direct = runCivilization(tidal, { ticks: 1000 })
  const initial = createCivilization(tidal)
  const first = advanceCivilization(tidal, initial, 100)
  const second = advanceCivilization(tidal, first.state, 900)
  assert.deepEqual(second.state, direct.state)
  assert.deepEqual([...first.events, ...second.events], direct.events)
  assert.equal(direct.state.tick, 1000)
  assert.equal(direct.state.status, "completed")
  assert.equal(direct.state.historyHash, "52b636ac")
  assert.equal(direct.events.length, 44)
  assert.ok(direct.state.milestones.some((entry) => entry.id === "era_settlement"))
})

test("civilization engine never mutates the supplied spec or state", () => {
  const specBefore = structuredClone(tidal)
  const state = createCivilization(tidal)
  const stateBefore = structuredClone(state)
  advanceCivilization(tidal, state, 100)
  assert.deepEqual(tidal, specBefore)
  assert.deepEqual(state, stateBefore)
})

test("a civilization can deterministically collapse before its maximum tick", () => {
  const result = runCivilization(ember)
  assert.equal(result.state.status, "collapsed")
  assert.equal(result.state.tick, 850)
  assert.equal(result.state.ecology, 0)
  assert.equal(result.events.at(-1).type, "civilization_collapsed")
})

test("all presets stay bounded and deterministic for their full run", () => {
  for (const preset of presets) {
    const first = runCivilization(preset)
    const second = runCivilization(preset)
    assert.deepEqual(first, second)
    assert.ok(first.state.population >= 0 && first.state.population <= 1000000000)
    assert.ok(first.state.resources >= 0 && first.state.resources <= 1000000000)
    assert.ok(first.state.knowledge >= 0 && first.state.knowledge <= 1000000000)
    assert.ok(first.state.ecology >= 0 && first.state.ecology <= 100)
    assert.ok(first.state.cohesion >= 0 && first.state.cohesion <= 100)
    assert.match(first.state.historyHash, /^[0-9a-f]{8}$/)
    assert.equal(first.events.at(-1).cursor, first.state.eventCursor)
  }
  assert.equal(new Set(presets.map((preset) => runCivilization(preset).state.historyHash)).size, presets.length)
})

test("invalid specs, altered state ownership and excessive batches fail closed", () => {
  assert.throws(() => validateCivilizationSpec({ ...tidal, unexpected: true }), (error) => error instanceof CivilizationError)
  const state = createCivilization(tidal)
  assert.throws(() => advanceCivilization(tidal, { ...state, specId: "other" }, 1), (error) => error.code === "civilization_conflict")
  assert.throws(() => advanceCivilization(tidal, state, 10001), (error) => error.code === "invalid_advance")
})
