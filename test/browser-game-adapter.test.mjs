// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { loadOriginPack } from "../src/load-pack.mjs"
import { EsipAdapter, MemoryRouter, TYPES, createBrowserEvolutionAdapter } from "../src/interop/index.mjs"

const GAME = "esip://browser/sandbox"
const CONTROL_A = "esip://browser/control-a"
const CONTROL_B = "esip://browser/control-b"
const ACTOR_A = "actor-alpha"
const ACTOR_B = "actor-beta"
const IDENTITIES = [{ source: CONTROL_A, actorId: ACTOR_A }, { source: CONTROL_B, actorId: ACTOR_B }]
const pack = await loadOriginPack()

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

function actorContext(game, actorId) {
  const state = game.getActorState(actorId)
  return { universeId: "universe-1", timelineId: state.timeline, realmId: state.phase, actorId }
}

async function connectWorld(storage, initialSequences = {}) {
  const router = new MemoryRouter({
    authorize: (message) => message.kind === "event" || message.kind === "result"
      || (IDENTITIES.some((identity) => identity.source === message.source) && message.target === GAME),
  })
  let requested
  router.subscribe("io.evolution.*", async (message) => {
    if (message.kind === "command" || message.kind === "query") requested = message
  })
  const game = createBrowserEvolutionAdapter({ pack, storage, identities: IDENTITIES, primaryActorId: ACTOR_A })
  await game.connect(router)

  async function connectControl(source, actorId) {
    const messages = []
    const control = new EsipAdapter({
      id: source.endsWith("a") ? "browser-control-a" : "browser-control-b",
      source,
      platform: "browser-ui",
      consumes: [
        TYPES.ACTION_APPLIED,
        TYPES.STATE_SNAPSHOT,
        TYPES.REALM_TRANSITIONED,
        TYPES.TIMELINE_CREATED_V2,
        TYPES.TIMELINE_JOINED,
        TYPES.TIMELINE_REGISTRY_SNAPSHOT,
        TYPES.ERROR,
      ],
      produces: [
        TYPES.ACTION_REQUESTED,
        TYPES.STATE_REQUESTED,
        TYPES.TIMELINE_CREATE_REQUESTED,
        TYPES.TIMELINE_JOIN_REQUESTED,
        TYPES.TIMELINE_REGISTRY_REQUESTED,
      ],
      initialSequence: initialSequences[source] ?? 0,
      handle: async (message) => messages.push(message),
    })
    await control.connect(router)
    return { control, messages, actorId }
  }

  return {
    router,
    game,
    a: await connectControl(CONTROL_A, ACTOR_A),
    b: await connectControl(CONTROL_B, ACTOR_B),
    requested: () => requested,
  }
}

async function action(world, side, actionId, options = {}) {
  const actorId = side.actorId
  await side.control.emit(TYPES.ACTION_REQUESTED, "command", {
    context: actorContext(world.game, actorId),
    actionId,
    parameters: {},
    expectedRevision: world.game.getActorRevision(actorId),
  }, { id: options.id, target: GAME, subject: `actor/${actorId}` })
}

async function evolve(world, side) {
  for (const actionId of pack.demo) await action(world, side, actionId)
  assert.equal(world.game.getActorState(side.actorId).phase, "first_3d")
}

test("browser game persists actor state, sequence and duplicate responses across reload", async () => {
  const storage = new MemoryStorage()
  const first = await connectWorld(storage)
  await action(first, first.a, "observe", { id: "observe-once" })
  assert.equal(first.game.getActorRevision(ACTOR_A), 1)
  assert.equal(first.game.getActorState(ACTOR_A).information, 3)
  const original = first.requested()
  const sequences = { [CONTROL_A]: first.a.control.nextSequence, [CONTROL_B]: first.b.control.nextSequence }
  const gameSequence = first.game.nextSequence
  first.a.control.disconnect()
  first.b.control.disconnect()
  first.game.disconnect()

  const replayMessages = []
  const replayRouter = new MemoryRouter({ authorize: () => true })
  replayRouter.subscribe(TYPES.ACTION_APPLIED, async (message) => replayMessages.push(message))
  const reloaded = createBrowserEvolutionAdapter({ pack, storage, identities: IDENTITIES, primaryActorId: ACTOR_A })
  assert.equal(reloaded.getActorRevision(ACTOR_A), 1)
  assert.equal(reloaded.getActorState(ACTOR_A).information, 3)
  assert.equal(reloaded.nextSequence, gameSequence)
  await reloaded.connect(replayRouter)
  await replayRouter.publish(original)
  assert.equal(reloaded.getActorRevision(ACTOR_A), 1)
  assert.equal(replayMessages.at(-1).data.commandId, "observe-once")
  reloaded.disconnect()

  const second = await connectWorld(storage, sequences)
  await second.a.control.emit(TYPES.STATE_REQUESTED, "query", {
    context: { ...actorContext(second.game, ACTOR_A), timelineId: "stale-client-value" },
    fields: ["phase", "information"],
  }, { id: "state-after-reload", target: GAME, subject: `actor/${ACTOR_A}` })
  assert.equal(second.a.messages.at(-1).data.revision, 1)
  assert.equal(second.a.messages.at(-1).data.state.information, 3)
})

test("two actors create and join world timelines with registry conflict and catch-up semantics", async () => {
  const storage = new MemoryStorage()
  const world = await connectWorld(storage)
  await evolve(world, world.a)
  await evolve(world, world.b)

  await world.a.control.emit(TYPES.TIMELINE_CREATE_REQUESTED, "command", {
    context: actorContext(world.game, ACTOR_A),
    newTimelineId: "alpha-1",
    expectedStateRevision: world.game.getActorRevision(ACTOR_A),
    expectedRegistryRevision: 0,
  }, { id: "create-alpha", target: GAME, subject: `actor/${ACTOR_A}` })
  assert.equal(world.a.messages.at(-1).type, TYPES.TIMELINE_CREATED_V2)
  assert.equal(world.game.getActorState(ACTOR_A).timeline, "alpha-1")
  assert.equal(world.game.timelineRegistrySnapshot.revision, 1)

  await world.b.control.emit(TYPES.TIMELINE_CREATE_REQUESTED, "command", {
    context: actorContext(world.game, ACTOR_B),
    newTimelineId: "beta-1",
    expectedStateRevision: world.game.getActorRevision(ACTOR_B),
    expectedRegistryRevision: 0,
  }, { target: GAME, subject: `actor/${ACTOR_B}` })
  assert.equal(world.b.messages.at(-1).data.code, "registry_revision_conflict")
  assert.equal(world.game.getActorState(ACTOR_B).timeline, "origin")

  await world.b.control.emit(TYPES.TIMELINE_CREATE_REQUESTED, "command", {
    context: actorContext(world.game, ACTOR_B),
    newTimelineId: "beta-1",
    expectedStateRevision: world.game.getActorRevision(ACTOR_B),
    expectedRegistryRevision: 1,
  }, { target: GAME, subject: `actor/${ACTOR_B}` })
  assert.equal(world.game.timelineRegistrySnapshot.revision, 2)
  assert.equal(world.game.getActorState(ACTOR_B).timeline, "beta-1")

  await world.a.control.emit(TYPES.TIMELINE_JOIN_REQUESTED, "command", {
    context: actorContext(world.game, ACTOR_A),
    targetTimelineId: "beta-1",
    expectedStateRevision: world.game.getActorRevision(ACTOR_A),
    expectedRegistryRevision: 2,
  }, { target: GAME, subject: `actor/${ACTOR_A}` })
  assert.equal(world.a.messages.at(-1).type, TYPES.TIMELINE_JOINED)
  assert.equal(world.game.getActorState(ACTOR_A).timeline, "beta-1")
  assert.equal(world.game.timelineRegistrySnapshot.revision, 2)

  await world.b.control.emit(TYPES.TIMELINE_REGISTRY_REQUESTED, "query", {
    context: actorContext(world.game, ACTOR_B), afterRevision: 0,
  }, { target: GAME, subject: `actor/${ACTOR_B}` })
  const registry = world.b.messages.at(-1)
  assert.equal(registry.type, TYPES.TIMELINE_REGISTRY_SNAPSHOT)
  assert.deepEqual(registry.data.events.map((event) => event.timelineId), ["alpha-1", "beta-1"])

  const sequences = { [CONTROL_A]: world.a.control.nextSequence, [CONTROL_B]: world.b.control.nextSequence }
  world.a.control.disconnect()
  world.b.control.disconnect()
  world.game.disconnect()
  const reconnected = await connectWorld(storage, sequences)
  await reconnected.a.control.emit(TYPES.TIMELINE_REGISTRY_REQUESTED, "query", {
    context: actorContext(reconnected.game, ACTOR_A), afterRevision: 1,
  }, { target: GAME, subject: `actor/${ACTOR_A}` })
  const catchUp = reconnected.a.messages.at(-1).data
  assert.equal(catchUp.registryRevision, 2)
  assert.deepEqual(catchUp.events.map((event) => event.timelineId), ["beta-1"])
  assert.equal(catchUp.truncated, false)
})

test("source-to-actor mapping rejects impersonation and identity rebinding", async () => {
  const world = await connectWorld(new MemoryStorage())
  await world.a.control.emit(TYPES.STATE_REQUESTED, "query", {
    context: { ...actorContext(world.game, ACTOR_A), actorId: ACTOR_B }, fields: ["phase"],
  }, { target: GAME, subject: `actor/${ACTOR_B}` })
  assert.equal(world.a.messages.at(-1).data.code, "actor_mismatch")
  assert.throws(() => world.game.registerIdentity(CONTROL_A, ACTOR_B), (error) => error.code === "identity_conflict")
})

test("browser game migrates v1 storage and fails closed on corrupt state", () => {
  const storage = new MemoryStorage()
  storage.setItem("evolution-sandbox.esip.browser.v1", JSON.stringify({
    schema: 1,
    actorId: ACTOR_A,
    universeId: "universe-1",
    state: { ...pack.initialState },
    revision: 3,
    nextSequence: 4,
    lastSequences: {},
    processed: [],
  }))
  const migrated = createBrowserEvolutionAdapter({ pack, storage, identities: IDENTITIES, primaryActorId: ACTOR_A })
  assert.equal(migrated.getActorRevision(ACTOR_A), 3)
  assert.equal(JSON.parse(storage.getItem("evolution-sandbox.esip.browser.v1")).schema, 2)

  storage.setItem("evolution-sandbox.esip.browser.v1", "{not-json")
  assert.throws(() => createBrowserEvolutionAdapter({ pack, storage, identities: IDENTITIES }), (error) => error.code === "invalid_storage")
})
