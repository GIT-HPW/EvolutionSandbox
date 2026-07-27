// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { EsipAdapter, MemoryRouter, TYPES, createDirectorAdapter } from "../src/interop/index.mjs"

const DIRECTOR = "esip://evolution/director-alpha"
const CLIENT = "esip://local/director-control"

function goalData(overrides = {}) {
  return {
    context: { universeId: "universe-1", timelineId: "origin", realmId: "first_3d", actorId: "director-player" },
    goal: "让宇宙进入星辰时代",
    observation: {
      sceneId: "origin",
      phase: "first_3d",
      stateRevision: 7,
      availableActions: ["create", "destroy", "stabilize"],
      completedMilestones: ["realm_anchored"],
      availableScenes: ["origin", "stellar"],
    },
    expectedDirectorRevision: 0,
    ...overrides,
  }
}

function createClient(source, messages) {
  return new EsipAdapter({
    id: `client-${source.split("/").at(-1)}`,
    source,
    platform: "test",
    consumes: [TYPES.DIRECTOR_DECIDED, TYPES.ERROR],
    produces: [TYPES.DIRECTOR_GOAL_REQUESTED],
    handle: async (message) => messages.push(message),
  })
}

async function connectPair({ record, directorChanged = async () => {}, source = CLIENT } = {}) {
  const messages = []
  const router = new MemoryRouter({ authorize: () => true })
  const director = createDirectorAdapter({
    source: DIRECTOR,
    bindings: [{ source: CLIENT, actorId: "director-player", universeId: "universe-1" }],
    record,
    directorChanged,
  })
  const client = createClient(source, messages)
  await director.connect(router)
  await client.connect(router)
  return { director, client, messages }
}

test("director adapter returns audited proposals without applying game state", async () => {
  const persisted = []
  const { director, client, messages } = await connectPair({ directorChanged: async (record) => persisted.push(record) })
  await client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData(), {
    id: "director-goal-1",
    target: DIRECTOR,
    subject: "actor/director-player",
  })
  const decision = messages.at(-1)
  assert.equal(decision.type, TYPES.DIRECTOR_DECIDED)
  assert.equal(decision.data.outcome, "proposed")
  assert.equal(decision.data.intent.type, "scene_transition_request")
  assert.equal(decision.data.intent.parameters.mode, "manual_confirm")
  assert.equal(decision.data.revision, 1)
  assert.equal(decision.data.respondingTo, "director-goal-1")
  assert.equal(decision.causationid, "director-goal-1")
  assert.equal(director.directorRevision, 1)
  assert.equal(persisted.length, 1)

  await client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData({
    goal: "观察宇宙",
    expectedDirectorRevision: 0,
  }), { id: "director-stale-1", target: DIRECTOR, subject: "actor/director-player" })
  assert.equal(messages.at(-1).type, TYPES.ERROR)
  assert.equal(messages.at(-1).data.code, "revision_conflict")
  assert.equal(director.directorRevision, 1)
  assert.equal(persisted.length, 1)
})

test("director adapter rejects unauthorized sources before evaluating goals", async () => {
  const attacker = "esip://local/untrusted-director"
  const { director, client, messages } = await connectPair({ source: attacker })
  await client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData(), {
    id: "director-untrusted-1",
    target: DIRECTOR,
  })
  assert.equal(messages.at(-1).type, TYPES.ERROR)
  assert.equal(messages.at(-1).data.code, "director_source_forbidden")
  assert.equal(director.directorRevision, 0)
})

test("director adapter binds an authorized source to one actor and universe", async () => {
  const { director, client, messages } = await connectPair()
  await client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData({
    context: { universeId: "universe-1", timelineId: "origin", realmId: "first_3d", actorId: "another-player" },
  }), {
    id: "director-impersonation-1",
    target: DIRECTOR,
    subject: "actor/another-player",
  })
  assert.equal(messages.at(-1).type, TYPES.ERROR)
  assert.equal(messages.at(-1).data.code, "director_identity_mismatch")
  assert.equal(director.directorRevision, 0)

  await client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData(), {
    id: "director-subject-mismatch-1",
    target: DIRECTOR,
    subject: "actor/another-player",
  })
  assert.equal(messages.at(-1).data.code, "director_identity_mismatch")
  assert.equal(director.directorRevision, 0)
})

test("director adapter rolls back when audit persistence fails", async () => {
  const { director, client, messages } = await connectPair({
    directorChanged: async () => { throw new Error("simulated director storage failure") },
  })
  await client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData(), {
    id: "director-persistence-1",
    target: DIRECTOR,
    subject: "actor/director-player",
  })
  assert.equal(messages.at(-1).type, TYPES.ERROR)
  assert.equal(messages.at(-1).data.code, "director_error")
  assert.match(messages.at(-1).data.message, /storage failure/)
  assert.equal(director.directorRevision, 0)
  assert.equal(director.directorRecord.processed.length, 0)
})

test("restored director records replay the same request without a second decision", async () => {
  const first = await connectPair()
  const data = goalData()
  await first.client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", data, {
    id: "director-replay-1",
    target: DIRECTOR,
    subject: "actor/director-player",
  })
  const original = first.messages.at(-1).data
  const record = first.director.directorRecord

  let writes = 0
  const restored = await connectPair({ record, directorChanged: async () => { writes += 1 } })
  await restored.client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", data, {
    id: "director-replay-1",
    target: DIRECTOR,
    subject: "actor/director-player",
  })
  assert.deepEqual(restored.messages.at(-1).data, original)
  assert.equal(restored.director.directorRevision, 1)
  assert.equal(writes, 0)

  const conflict = await connectPair({ record })
  await conflict.client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", {
    ...data,
    goal: "改成另一个目标",
  }, { id: "director-replay-1", target: DIRECTOR, subject: "actor/director-player" })
  assert.equal(conflict.messages.at(-1).type, TYPES.ERROR)
  assert.equal(conflict.messages.at(-1).data.code, "id_conflict")
  assert.equal(conflict.director.directorRevision, 1)
})

test("director record restoration fails closed on changed policy ownership or audit data", async () => {
  const first = await connectPair()
  await first.client.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", goalData(), {
    id: "director-record-1",
    target: DIRECTOR,
    subject: "actor/director-player",
  })
  const wrongPolicy = first.director.directorRecord
  wrongPolicy.policyId = "another-policy"
  assert.throws(
    () => createDirectorAdapter({
      source: DIRECTOR,
      bindings: [{ source: CLIENT, actorId: "director-player", universeId: "universe-1" }],
      record: wrongPolicy,
    }),
    /another policy/,
  )

  const corruptAudit = first.director.directorRecord
  corruptAudit.processed[0].decision.audit.requestHash = "not-a-hash"
  assert.throws(
    () => createDirectorAdapter({
      source: DIRECTOR,
      bindings: [{ source: CLIENT, actorId: "director-player", universeId: "universe-1" }],
      record: corruptAudit,
    }),
    /audit is invalid/,
  )
})
