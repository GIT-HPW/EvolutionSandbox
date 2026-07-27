// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_DIRECTOR_POLICY, decideDirectorGoal } from "../src/director/index.mjs"

function observation(overrides = {}) {
  return {
    sceneId: "origin",
    phase: "first_3d",
    stateRevision: 7,
    availableActions: ["observe", "create", "destroy", "stabilize"],
    completedMilestones: [],
    availableScenes: ["origin", "stellar"],
    ...overrides,
  }
}

test("deterministic fake director maps the same goal and observation to the same safe intent", () => {
  const input = { goal: "请继续观察这个新生宇宙", observation: observation() }
  const first = decideDirectorGoal(input)
  const second = decideDirectorGoal(input)
  assert.deepEqual(first, second)
  assert.equal(first.outcome, "proposed")
  assert.equal(first.intent.type, "action_suggestion")
  assert.equal(first.intent.parameters.actionId, "observe")
  assert.equal(first.audit.engine, "deterministic_fake")
  assert.match(first.audit.requestHash, /^[0-9a-f]{8}$/)
})

test("scene transition intent requires an allowed build scene and confirmed milestone", () => {
  const blocked = decideDirectorGoal({ goal: "让宇宙进入星辰时代", observation: observation() })
  assert.equal(blocked.outcome, "rejected")
  assert.equal(blocked.reasonCode, "milestone_required")
  assert.equal(blocked.intent, null)

  const proposed = decideDirectorGoal({
    goal: "让宇宙进入星辰时代",
    observation: observation({ completedMilestones: ["realm_anchored"] }),
  })
  assert.equal(proposed.outcome, "proposed")
  assert.equal(proposed.intent.type, "scene_transition_request")
  assert.deepEqual(proposed.intent.parameters, {
    fromScene: "origin",
    toScene: "stellar",
    requiredMilestone: "realm_anchored",
    mode: "manual_confirm",
  })

  const unavailable = decideDirectorGoal({ goal: "现在建立文明", observation: observation() })
  assert.equal(unavailable.outcome, "rejected")
  assert.equal(unavailable.reasonCode, "scene_unavailable")
})

test("unavailable actions are rejected and unmatched goals stay narrative-only", () => {
  const unavailable = decideDirectorGoal({
    goal: "触发大爆炸",
    observation: observation({ availableActions: ["observe"] }),
  })
  assert.equal(unavailable.outcome, "rejected")
  assert.equal(unavailable.reasonCode, "action_unavailable")

  const narrative = decideDirectorGoal({ goal: "让世界保持好奇与耐心", observation: observation() })
  assert.equal(narrative.outcome, "proposed")
  assert.equal(narrative.intent.type, "narrative_cue")
  assert.match(narrative.intent.parameters.cue, /好奇与耐心/)
})

test("director policy and observation validation fail closed", () => {
  assert.throws(
    () => decideDirectorGoal({ goal: "观察", observation: observation({ availableScenes: ["stellar"] }) }),
    /must include the current scene/,
  )
  assert.throws(
    () => decideDirectorGoal({
      goal: "观察",
      observation: observation(),
      policy: { ...DEFAULT_DIRECTOR_POLICY, allowedActions: ["observe", "observe"] },
    }),
    /duplicate observe/,
  )
  const forbiddenScene = decideDirectorGoal({
    goal: "保持耐心",
    observation: observation({ sceneId: "civilization", phase: "civic", availableScenes: ["civilization"] }),
  })
  assert.equal(forbiddenScene.outcome, "rejected")
  assert.equal(forbiddenScene.reasonCode, "scene_forbidden")
})
