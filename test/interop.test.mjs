// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { loadOriginPack } from "../src/load-pack.mjs"
import {
  EsipAdapter,
  EsipError,
  MESSAGE_DEFINITIONS,
  MemoryRouter,
  TYPES,
  createEvolutionRulesAdapter,
  createMessage,
  validateMessage,
} from "../src/interop/index.mjs"

const NOW = new Date("2026-07-17T00:00:00.000Z")
const pack = await loadOriginPack()

function hello({ id = "hello-1", sequence = 0, platform = "test" } = {}) {
  return createMessage({
    id,
    source: "esip://test/source",
    type: TYPES.CAPABILITY_HELLO,
    kind: "event",
    sequence,
    data: {
      adapterId: "test-adapter",
      platform,
      protocolVersions: ["0.1"],
      consumes: [],
      produces: [],
      maxMessageBytes: 65536,
    },
  }, { now: () => NOW, idFactory: () => id })
}

function actionRequest({ id = "command-1", sequence = 0, expectedRevision = 0, parameters = {} } = {}) {
  return createMessage({
    id,
    source: "esip://web/client",
    target: "esip://luanti/world",
    type: TYPES.ACTION_REQUESTED,
    kind: "command",
    sequence,
    subject: "actor/player-1",
    data: {
      context: { universeId: "u-1", timelineId: "origin", realmId: "origin_0d", actorId: "player-1" },
      actionId: "observe",
      parameters,
      expectedRevision,
    },
  }, { now: () => NOW, idFactory: () => id })
}

test("message construction enforces ESIP kind, target and known payload", () => {
  const message = actionRequest()
  assert.equal(validateMessage(message), message)
  assert.throws(() => createMessage({ ...message, target: undefined }, { now: () => NOW }), (error) => {
    assert.ok(error instanceof EsipError)
    assert.equal(error.code, "invalid_message")
    return true
  })
  assert.throws(() => validateMessage({ ...message, kind: "event" }), (error) => error.code === "kind_mismatch")
  assert.throws(() => validateMessage({ ...message, type: "io.evolution.custom.unknown.v1" }), (error) => error.code === "unknown_type")
  assert.throws(() => validateMessage({ ...message, dataschema: "https://example.invalid/wrong.json" }), (error) => error.code === "schema_mismatch")
  assert.throws(() => validateMessage({ ...message, data: { ...message.data, unexpected: true } }), (error) => error.code === "invalid_message")
  assert.throws(() => validateMessage({ ...message, unexpected: true }), (error) => error.code === "invalid_message")
  assert.throws(() => validateMessage({ ...message, data: { ...message.data, parameters: { value: Number.NaN } } }), (error) => error.code === "invalid_message")
  assert.throws(() => createMessage({ ...message, id: "expired-1", expiresat: NOW.toISOString() }, { now: () => NOW }), (error) => error.code === "expired")
})

test("router is idempotent and detects id conflicts and sequence replay", async () => {
  const router = new MemoryRouter({ now: () => NOW.getTime() })
  let deliveries = 0
  router.subscribe(TYPES.CAPABILITY_HELLO, async () => { deliveries += 1 })
  const message = hello()
  assert.equal((await router.publish(message)).accepted, true)
  const reordered = Object.fromEntries(Object.entries(message).reverse())
  assert.equal((await router.publish(reordered)).duplicate, true)
  assert.equal(deliveries, 1)
  await assert.rejects(router.publish(hello({ platform: "changed" })), (error) => error.code === "id_conflict")
  await assert.rejects(router.publish(hello({ id: "hello-2", sequence: 0 })), (error) => error.code === "sequence_replay")
})

test("router denies commands and queries unless policy explicitly grants them", async () => {
  const router = new MemoryRouter({ now: () => NOW.getTime() })
  await assert.rejects(router.publish(actionRequest()), (error) => error.code === "forbidden")
})

test("router enforces a message size boundary before delivery", async () => {
  const router = new MemoryRouter({ authorize: () => true, maxMessageBytes: 1024, now: () => NOW.getTime() })
  await assert.rejects(router.publish(actionRequest({ parameters: { blob: "x".repeat(2048) } })), (error) => error.code === "message_too_large")
})

test("adapter capabilities and target filtering prevent unintended command handling", async () => {
  const router = new MemoryRouter({ authorize: () => true, now: () => Date.now() })
  let first = 0
  let second = 0
  const receiverA = new EsipAdapter({
    id: "receiver-a", source: "esip://game/a", platform: "test",
    consumes: [TYPES.ACTION_REQUESTED], produces: [],
    handle: async () => { first += 1 },
  })
  const receiverB = new EsipAdapter({
    id: "receiver-b", source: "esip://game/b", platform: "test",
    consumes: [TYPES.ACTION_REQUESTED], produces: [],
    handle: async () => { second += 1 },
  })
  const sender = new EsipAdapter({
    id: "sender", source: "esip://web/sender", platform: "web",
    consumes: [], produces: [TYPES.ACTION_REQUESTED],
  })
  await receiverA.connect(router)
  await receiverB.connect(router)
  await sender.connect(router)
  await sender.emit(TYPES.ACTION_REQUESTED, "command", {
    context: { universeId: "u-1", timelineId: "origin", realmId: "origin_0d", actorId: "player-1" },
    actionId: "observe", parameters: {}, expectedRevision: 0,
  }, { target: receiverA.source, subject: "actor/player-1" })
  assert.equal(first, 1)
  assert.equal(second, 0)
  await assert.rejects(sender.emit(TYPES.TIMELINE_CREATED, "event", {}, {}), (error) => error.code === "capability_violation")
})

test("other games can register a namespaced message type without weakening default rejection", async () => {
  const type = "com.example.spacegame.player_spawned.v1"
  const definitions = {
    ...MESSAGE_DEFINITIONS,
    [type]: {
      kind: "event",
      dataschema: "https://example.com/schemas/player-spawned-v1.json",
      validate(data) {
        if (typeof data.playerId !== "string" || typeof data.spawnPoint !== "string") {
          throw new EsipError("invalid_message", "custom spawn payload is invalid")
        }
      },
    },
  }
  const router = new MemoryRouter({ definitions })
  let received
  router.subscribe(type, async (message) => { received = message })
  const adapter = new EsipAdapter({
    id: "spacegame-a", source: "esip://spacegame/world-a", platform: "custom",
    consumes: [], produces: [type], definitions,
  })
  await adapter.connect(router)
  await adapter.emit(type, "event", { playerId: "opaque-7", spawnPoint: "gate-a" })
  assert.equal(received.type, type)
  assert.equal(received.dataschema, definitions[type].dataschema)
  assert.throws(() => validateMessage(received), (error) => error.code === "unknown_type")
  assert.equal(validateMessage(received, { definitions }), received)
})

test("Evolution adapter completes the origin loop and answers state queries", async () => {
  const LUANTI = "esip://luanti/world-alpha"
  const WEB = "esip://web/client"
  const messages = []
  const router = new MemoryRouter({
    authorize: (message) => message.kind === "event" || message.kind === "result"
      || (message.source === WEB && message.target === LUANTI),
  })
  const evolution = createEvolutionRulesAdapter({ pack, source: LUANTI })
  const client = new EsipAdapter({
    id: "test-client", source: WEB, platform: "test",
    consumes: [TYPES.ACTION_APPLIED, TYPES.STATE_SNAPSHOT, TYPES.REALM_TRANSITIONED, TYPES.ERROR],
    produces: [TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED],
    handle: async (message) => messages.push(message),
  })
  await evolution.connect(router)
  await client.connect(router)

  const context = () => ({
    universeId: "u-1", timelineId: evolution.stateSnapshot.timeline,
    realmId: evolution.stateSnapshot.phase, actorId: "player-1",
  })
  await client.emit(TYPES.ACTION_REQUESTED, "command", {
    context: context(), actionId: "observe", parameters: {}, expectedRevision: 99,
  }, { target: LUANTI, subject: "actor/player-1" })
  assert.equal(messages.at(-1).data.code, "revision_conflict")
  assert.equal(evolution.revision, 0)

  for (const actionId of pack.demo) {
    await client.emit(TYPES.ACTION_REQUESTED, "command", {
      context: context(), actionId, parameters: {}, expectedRevision: evolution.revision,
    }, { target: LUANTI, subject: "actor/player-1", correlationid: "test-loop" })
  }
  assert.equal(evolution.stateSnapshot.phase, "first_3d")
  assert.equal(evolution.revision, pack.demo.length)
  assert.equal(messages.filter((message) => message.type === TYPES.REALM_TRANSITIONED).length, 1)

  await client.emit(TYPES.STATE_REQUESTED, "query", {
    context: context(), fields: ["phase", "dimension"],
  }, { target: LUANTI, subject: "actor/player-1" })
  const snapshot = messages.findLast((message) => message.type === TYPES.STATE_SNAPSHOT)
  assert.equal(snapshot.data.state.phase, "first_3d")
  assert.equal(snapshot.data.revision, pack.demo.length)
})
