// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { applyAction, branchTimeline, createState, RuleError, validatePack } from "../src/rules-engine.mjs"
import { loadOriginPack } from "../src/load-pack.mjs"

const pack = await loadOriginPack()

test("origin content pack is structurally valid", () => {
  assert.equal(validatePack(pack), pack)
  assert.equal(createState(pack).phase, "origin_0d")
})

test("big bang is blocked before its requirements are met", () => {
  assert.throws(() => applyAction(pack, createState(pack), "big_bang"), (error) => {
    assert.ok(error instanceof RuleError)
    assert.equal(error.code, "requirement")
    return true
  })
})

test("the documented demo deterministically reaches the first 3D realm", () => {
  let first = createState(pack)
  let second = createState(pack)
  for (const action of pack.demo) {
    first = applyAction(pack, first, action).state
    second = applyAction(pack, second, action).state
  }
  assert.deepEqual(first, second)
  assert.equal(first.phase, "first_3d")
  assert.equal(first.dimension, 3)
  assert.equal(first.steps, 7)
})

test("timeline branches are validated and only available in 3D", () => {
  assert.throws(() => branchTimeline(createState(pack), "alpha"), /进入三维领域/)
  let state = createState(pack)
  for (const action of pack.demo) state = applyAction(pack, state, action).state
  assert.equal(branchTimeline(state, "alpha-1").timeline, "alpha-1")
  assert.throws(() => branchTimeline(state, "../unsafe"), /时间线名称/)
})

test("the first 3D realm requires real matter for stabilization and recycling", () => {
  let state = createState(pack)
  for (const action of pack.demo) state = applyAction(pack, state, action).state

  assert.throws(() => applyAction(pack, state, "destroy"), (error) => error.code === "requirement")
  assert.throws(() => applyAction(pack, state, "stabilize"), (error) => error.code === "requirement")

  state = applyAction(pack, state, "create").state
  state = applyAction(pack, state, "stabilize").state
  state = applyAction(pack, state, "destroy").state
  assert.equal(state.matter, 0)
  assert.equal(state.matterCreated, 1)
  assert.equal(state.matterStabilized, 1)
  assert.equal(state.matterRecycled, 1)
})
