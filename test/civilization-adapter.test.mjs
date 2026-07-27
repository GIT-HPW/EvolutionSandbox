// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  EsipAdapter,
  MemoryRouter,
  TYPES,
  createCivilizationAdapter,
  createCivilizationSidecarRuntime,
  createMemoryCivilizationRuntimeStore,
} from "../src/interop/index.mjs"
import { createWorldExperimentProposal } from "../src/world-experiment/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tidal = JSON.parse(await readFile(resolve(root, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"))
const ENGINE = "esip://evolution/civilization-alpha"
const CLIENT = "esip://local/civilization-control"

function context(timelineId = "origin") {
  return { universeId: "universe-1", timelineId, actorId: "actor-42" }
}

function expiresSoon() {
  return new Date(Date.now() + 60_000).toISOString()
}

test("civilization ESIP adapter creates, advances, branches and answers snapshots", async () => {
  const messages = []
  const persisted = []
  const router = new MemoryRouter({ authorize: () => true })
  const engine = createCivilizationAdapter({
    source: ENGINE,
    controllerChanged: async (record) => persisted.push(record),
  })
  const client = new EsipAdapter({
    id: "civilization-control",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_CREATED, TYPES.CIVILIZATION_UPDATED, TYPES.CIVILIZATION_SNAPSHOT, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_CREATE_REQUESTED, TYPES.CIVILIZATION_COMMAND_REQUESTED, TYPES.CIVILIZATION_SNAPSHOT_REQUESTED],
    handle: async (message) => messages.push(message),
  })
  await engine.connect(router)
  await client.connect(router)

  await client.emit(TYPES.CIVILIZATION_CREATE_REQUESTED, "command", {
    context: context(), spec: tidal, snapshotInterval: 50,
  }, { target: ENGINE, subject: "civilization/tidal_archive" })
  assert.equal(messages.at(-1).type, TYPES.CIVILIZATION_CREATED)
  assert.equal(messages.at(-1).data.snapshot.state.tick, 0)
  assert.equal(engine.revision, 0)

  await client.emit(TYPES.CIVILIZATION_COMMAND_REQUESTED, "command", {
    context: context(), action: "advance", ticks: 120, expectedRevision: 0,
  }, { target: ENGINE, subject: "civilization/tidal_archive" })
  assert.equal(messages.at(-1).type, TYPES.CIVILIZATION_UPDATED)
  assert.equal(messages.at(-1).data.snapshot.state.tick, 120)
  assert.equal(messages.at(-1).tick, 120)

  await client.emit(TYPES.CIVILIZATION_COMMAND_REQUESTED, "command", {
    context: context(), action: "branch", newTimelineId: "green-path", atTick: 75, expectedRevision: 1,
  }, { target: ENGINE, subject: "civilization/tidal_archive" })
  assert.equal(messages.at(-1).data.snapshot.activeTimelineId, "green-path")
  assert.equal(messages.at(-1).data.snapshot.state.tick, 75)

  await client.emit(TYPES.CIVILIZATION_SNAPSHOT_REQUESTED, "query", {
    context: context("green-path"), recentEvents: 0,
  }, { target: ENGINE, subject: "civilization/tidal_archive" })
  assert.equal(messages.at(-1).type, TYPES.CIVILIZATION_SNAPSHOT)
  assert.equal(messages.at(-1).data.revision, 2)
  assert.equal(messages.at(-1).data.snapshot.timelines.length, 2)
  assert.equal(messages.at(-1).data.snapshot.recentEvents.length, 0)
  assert.equal(persisted.length, 3)
})

test("civilization ESIP adapter reports revision conflicts without mutating state", async () => {
  const messages = []
  const router = new MemoryRouter({ authorize: () => true })
  const engine = createCivilizationAdapter({ source: ENGINE })
  const client = new EsipAdapter({
    id: "civilization-conflict-client",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_CREATED, TYPES.CIVILIZATION_UPDATED, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_CREATE_REQUESTED, TYPES.CIVILIZATION_COMMAND_REQUESTED],
    handle: async (message) => messages.push(message),
  })
  await engine.connect(router)
  await client.connect(router)
  await client.emit(TYPES.CIVILIZATION_CREATE_REQUESTED, "command", {
    context: context(), spec: tidal,
  }, { target: ENGINE })
  await client.emit(TYPES.CIVILIZATION_COMMAND_REQUESTED, "command", {
    context: context(), action: "advance", ticks: 10, expectedRevision: 99,
  }, { target: ENGINE })

  assert.equal(messages.at(-1).type, TYPES.ERROR)
  assert.equal(messages.at(-1).data.code, "revision_conflict")
  assert.equal(messages.at(-1).data.retryable, true)
  assert.equal(engine.controllerSnapshot.state.tick, 0)
  assert.equal(engine.revision, 0)
})

test("civilization ESIP adapter rolls back a command when authoritative persistence fails", async () => {
  const messages = []
  let writes = 0
  const router = new MemoryRouter({ authorize: () => true })
  const engine = createCivilizationAdapter({
    source: ENGINE,
    controllerChanged: async () => {
      writes += 1
      if (writes === 2) throw new Error("simulated persistence failure")
    },
  })
  const client = new EsipAdapter({
    id: "civilization-persistence-client",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_CREATED, TYPES.CIVILIZATION_UPDATED, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_CREATE_REQUESTED, TYPES.CIVILIZATION_COMMAND_REQUESTED],
    handle: async (message) => messages.push(message),
  })
  await engine.connect(router)
  await client.connect(router)
  await client.emit(TYPES.CIVILIZATION_CREATE_REQUESTED, "command", {
    context: context(), spec: tidal,
  }, { target: ENGINE })
  await client.emit(TYPES.CIVILIZATION_COMMAND_REQUESTED, "command", {
    context: context(), action: "advance", ticks: 50, expectedRevision: 0,
  }, { target: ENGINE })

  assert.equal(messages.at(-1).type, TYPES.ERROR)
  assert.equal(messages.at(-1).data.code, "civilization_error")
  assert.equal(engine.controllerSnapshot.state.tick, 0)
  assert.equal(engine.revision, 0)
})

test("civilization ESIP adapter restores its authority through the sidecar runtime", async () => {
  const store = createMemoryCivilizationRuntimeStore()
  const runtime = createCivilizationSidecarRuntime({
    store,
    leaseMs: 100,
    token: () => "adapter-pulse-worker",
  })
  const messages = []
  const router = new MemoryRouter({ authorize: () => true })
  const engine = createCivilizationAdapter({ source: ENGINE, runtime })
  const client = new EsipAdapter({
    id: "civilization-runtime-client",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_CREATED, TYPES.CIVILIZATION_UPDATED, TYPES.CIVILIZATION_SNAPSHOT, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_CREATE_REQUESTED, TYPES.CIVILIZATION_COMMAND_REQUESTED, TYPES.CIVILIZATION_SNAPSHOT_REQUESTED],
    handle: async (message) => messages.push(message),
  })
  await engine.connect(router)
  await client.connect(router)
  await client.emit(TYPES.CIVILIZATION_CREATE_REQUESTED, "command", {
    context: context(), spec: tidal,
  }, { target: ENGINE })
  await client.emit(TYPES.CIVILIZATION_COMMAND_REQUESTED, "command", {
    context: context(), action: "resume", expectedRevision: 0,
  }, { target: ENGINE })
  const pulsed = await runtime.pulse("adapter-scheduler-slot", { now: 1000 })
  assert.equal(pulsed.snapshot.state.tick, 1)

  const restoredRuntime = createCivilizationSidecarRuntime({ store })
  const restoredMessages = []
  const restoredRouter = new MemoryRouter({ authorize: () => true })
  const restoredEngine = createCivilizationAdapter({ source: ENGINE, runtime: restoredRuntime })
  const restoredClient = new EsipAdapter({
    id: "civilization-restored-client",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_SNAPSHOT, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_SNAPSHOT_REQUESTED],
    handle: async (message) => restoredMessages.push(message),
  })
  await restoredEngine.connect(restoredRouter)
  await restoredClient.connect(restoredRouter)
  await restoredClient.emit(TYPES.CIVILIZATION_SNAPSHOT_REQUESTED, "query", {
    context: context(), recentEvents: 8,
  }, { target: ENGINE })

  assert.equal(restoredMessages.at(-1).type, TYPES.CIVILIZATION_SNAPSHOT)
  assert.equal(restoredMessages.at(-1).data.snapshot.state.tick, 1)
  assert.equal(restoredMessages.at(-1).data.snapshot.revision, 2)
  assert.equal(restoredEngine.revision, 2)
  assert.throws(
    () => createCivilizationAdapter({ runtime, controllerChanged: async () => {} }),
    /mutually exclusive/,
  )
})

test("civilization experiment ESIP review is read-only and commit stays explicit and restart-idempotent", async () => {
  const store = createMemoryCivilizationRuntimeStore()
  const runtime = createCivilizationSidecarRuntime({ store })
  const messages = []
  const router = new MemoryRouter({ authorize: () => true })
  const engine = createCivilizationAdapter({
    source: ENGINE,
    runtime,
    experimentBindings: [{ source: CLIENT, actorId: "actor-42", universeId: "universe-1" }],
  })
  const client = new EsipAdapter({
    id: "civilization-experiment-client",
    source: CLIENT,
    platform: "test",
    consumes: [
      TYPES.CIVILIZATION_CREATED,
      TYPES.CIVILIZATION_EXPERIMENT_REVIEWED,
      TYPES.CIVILIZATION_EXPERIMENT_COMMITTED,
      TYPES.ERROR,
    ],
    produces: [
      TYPES.CIVILIZATION_CREATE_REQUESTED,
      TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED,
      TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED,
    ],
    handle: async (message) => messages.push(message),
  })
  await engine.connect(router)
  await client.connect(router)
  await client.emit(TYPES.CIVILIZATION_CREATE_REQUESTED, "command", {
    context: context(), spec: tidal,
  }, { target: ENGINE, subject: "civilization/tidal_archive" })
  const source = engine.controllerSnapshot
  const proposal = createWorldExperimentProposal({
    universeId: "universe-1",
    sourceTimelineId: source.activeTimelineId,
    sourceTick: source.state.tick,
    sourceHistoryHash: source.state.historyHash,
    expectedRevision: source.revision,
    requestedBy: { type: "player", id: "actor-42" },
    intent: "ecology_policy",
    magnitude: 2,
    newTimelineId: "esip-ecology-trial",
    title: "ESIP 生态实验",
    rationale: "先通过只读消息复核，再由独立提交消息建立差异分支。",
  })
  const beforeReview = engine.controllerRecord

  await assert.rejects(
    client.emit(TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED, "query", {
      context: context(), proposal,
    }, { target: ENGINE, subject: "actor/actor-42" }),
    (error) => error.code === "invalid_message" && /requires expiresat/.test(error.message),
  )
  await client.emit(TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED, "query", {
    context: context(), proposal,
  }, { target: ENGINE, subject: "actor/actor-42", expiresat: expiresSoon() })
  const reviewed = messages.at(-1)
  assert.equal(reviewed.type, TYPES.CIVILIZATION_EXPERIMENT_REVIEWED)
  assert.equal(reviewed.data.status, "pending")
  assert.equal(reviewed.data.patch.ecology, 16)
  assert.deepEqual(engine.controllerRecord, beforeReview)

  await client.emit(TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED, "command", {
    context: context(), proposal, expectedRevision: proposal.expectedRevision,
  }, { target: ENGINE, subject: "actor/actor-42", expiresat: expiresSoon() })
  const committed = messages.at(-1)
  assert.equal(committed.type, TYPES.CIVILIZATION_EXPERIMENT_COMMITTED)
  assert.equal(committed.data.duplicate, false)
  assert.equal(committed.data.snapshot.activeTimelineId, "esip-ecology-trial")
  assert.equal(committed.data.revision, 1)

  const restoredRuntime = createCivilizationSidecarRuntime({ store })
  const restoredMessages = []
  const restoredRouter = new MemoryRouter({ authorize: () => true })
  const restoredEngine = createCivilizationAdapter({
    source: ENGINE,
    runtime: restoredRuntime,
    experimentBindings: [{ source: CLIENT, actorId: "actor-42", universeId: "universe-1" }],
  })
  const restoredClient = new EsipAdapter({
    id: "civilization-experiment-retry-client",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_EXPERIMENT_COMMITTED, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED],
    handle: async (message) => restoredMessages.push(message),
  })
  await restoredEngine.connect(restoredRouter)
  await restoredClient.connect(restoredRouter)
  await restoredClient.emit(TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED, "command", {
    context: context(), proposal, expectedRevision: proposal.expectedRevision,
  }, { target: ENGINE, subject: "actor/actor-42", expiresat: expiresSoon() })
  assert.equal(restoredMessages.at(-1).type, TYPES.CIVILIZATION_EXPERIMENT_COMMITTED)
  assert.equal(restoredMessages.at(-1).data.duplicate, true)
  assert.equal(restoredMessages.at(-1).data.snapshot.revision, 1)
  assert.equal(restoredMessages.at(-1).data.snapshot.state.tick, 0)
})

test("civilization experiment ESIP rejects unbound sources and mismatched actors", async () => {
  const messages = []
  const router = new MemoryRouter({ authorize: () => true })
  const engine = createCivilizationAdapter({
    source: ENGINE,
    experimentBindings: [{ source: CLIENT, actorId: "actor-42", universeId: "universe-1" }],
  })
  const client = new EsipAdapter({
    id: "civilization-experiment-auth-client",
    source: CLIENT,
    platform: "test",
    consumes: [TYPES.CIVILIZATION_CREATED, TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_CREATE_REQUESTED, TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED],
    handle: async (message) => messages.push(message),
  })
  await engine.connect(router)
  await client.connect(router)
  await client.emit(TYPES.CIVILIZATION_CREATE_REQUESTED, "command", {
    context: context(), spec: tidal,
  }, { target: ENGINE })
  const source = engine.controllerSnapshot
  const proposal = createWorldExperimentProposal({
    universeId: "universe-1",
    sourceTimelineId: "origin",
    sourceTick: source.state.tick,
    sourceHistoryHash: source.state.historyHash,
    expectedRevision: source.revision,
    requestedBy: { type: "player", id: "actor-42" },
    intent: "research_focus",
    magnitude: 1,
    newTimelineId: "auth-trial",
    title: "授权实验",
    rationale: "验证来源、主体和 actor 绑定。",
  })
  await client.emit(TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED, "query", {
    context: { ...context(), actorId: "actor-99" }, proposal,
  }, { target: ENGINE, subject: "actor/actor-99", expiresat: expiresSoon() })
  assert.equal(messages.at(-1).data.code, "experiment_identity_mismatch")

  const unknownMessages = []
  const unknown = new EsipAdapter({
    id: "unknown-experiment-client",
    source: "esip://local/unknown-experiment",
    platform: "test",
    consumes: [TYPES.ERROR],
    produces: [TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED],
    handle: async (message) => unknownMessages.push(message),
  })
  await unknown.connect(router)
  await unknown.emit(TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED, "query", {
    context: context(), proposal,
  }, { target: ENGINE, subject: "actor/actor-42", expiresat: expiresSoon() })
  assert.equal(unknownMessages.at(-1).data.code, "experiment_source_forbidden")
  assert.deepEqual(engine.controllerSnapshot, source)
})
