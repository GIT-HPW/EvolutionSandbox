// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { loadOriginPack } from "../src/load-pack.mjs"
import { EsipAdapter, MemoryRouter, TYPES, createBrowserEvolutionAdapter } from "../src/interop/index.mjs"

const GAME = "esip://browser/sandbox"
const CONTROL = "esip://browser/control"
const ACTOR = "browser-player"
const pack = await loadOriginPack()

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
}

async function connectPair(storage, initialSequence = 0) {
  const messages = []
  let requested
  const router = new MemoryRouter({
    authorize: (message) => message.kind === "event" || message.kind === "result"
      || (message.source === CONTROL && message.target === GAME),
  })
  router.subscribe(TYPES.ACTION_REQUESTED, async (message) => { requested = message })
  const game = createBrowserEvolutionAdapter({ pack, storage })
  const control = new EsipAdapter({
    id: "browser-control",
    source: CONTROL,
    platform: "browser-ui",
    consumes: [TYPES.ACTION_APPLIED, TYPES.STATE_SNAPSHOT, TYPES.REALM_TRANSITIONED, TYPES.TIMELINE_CREATED, TYPES.ERROR],
    produces: [TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED],
    initialSequence,
    handle: async (message) => messages.push(message),
  })
  await game.connect(router)
  await control.connect(router)
  return { router, game, control, messages, requested: () => requested }
}

function context(game) {
  const state = game.stateSnapshot
  return { universeId: "universe-1", timelineId: state.timeline, realmId: state.phase, actorId: ACTOR }
}

test("browser game persists authority state, sequence and duplicate responses across reload", async () => {
  const storage = new MemoryStorage()
  const first = await connectPair(storage)
  await first.control.emit(TYPES.ACTION_REQUESTED, "command", {
    context: context(first.game), actionId: "observe", parameters: {}, expectedRevision: 0,
  }, { id: "observe-once", target: GAME, subject: `actor/${ACTOR}` })
  assert.equal(first.game.revision, 1)
  assert.equal(first.game.stateSnapshot.information, 3)
  const original = first.requested()
  const controlSequence = first.control.nextSequence
  const gameSequence = first.game.nextSequence
  first.control.disconnect()
  first.game.disconnect()

  const replayMessages = []
  const replayRouter = new MemoryRouter({ authorize: () => true })
  replayRouter.subscribe(TYPES.ACTION_APPLIED, async (message) => replayMessages.push(message))
  const reloaded = createBrowserEvolutionAdapter({ pack, storage })
  assert.equal(reloaded.revision, 1)
  assert.equal(reloaded.stateSnapshot.information, 3)
  assert.equal(reloaded.nextSequence, gameSequence)
  await reloaded.connect(replayRouter)
  await replayRouter.publish(original)
  assert.equal(reloaded.revision, 1)
  assert.equal(reloaded.stateSnapshot.information, 3)
  assert.equal(replayMessages.at(-1).data.commandId, "observe-once")

  reloaded.disconnect()
  const second = await connectPair(storage, controlSequence)
  await second.control.emit(TYPES.STATE_REQUESTED, "query", {
    context: context(second.game), fields: ["phase", "information"],
  }, { id: "state-after-reload", target: GAME, subject: `actor/${ACTOR}` })
  assert.equal(second.messages.at(-1).data.revision, 1)
  assert.equal(second.messages.at(-1).data.state.information, 3)
})

test("browser game creates a timeline through ESIP and rejects stale or foreign context", async () => {
  const pair = await connectPair(new MemoryStorage())
  for (const actionId of pack.demo) {
    await pair.control.emit(TYPES.ACTION_REQUESTED, "command", {
      context: context(pair.game), actionId, parameters: {}, expectedRevision: pair.game.revision,
    }, { target: GAME, subject: `actor/${ACTOR}` })
  }
  assert.equal(pair.game.stateSnapshot.phase, "first_3d")
  await pair.control.emit(TYPES.ACTION_REQUESTED, "command", {
    context: context(pair.game), actionId: "branch_timeline", parameters: { name: "alpha-1" }, expectedRevision: pair.game.revision,
  }, { target: GAME, subject: `actor/${ACTOR}` })
  assert.equal(pair.game.stateSnapshot.timeline, "alpha-1")
  assert.equal(pair.messages.filter((message) => message.type === TYPES.TIMELINE_CREATED).length, 1)

  await pair.control.emit(TYPES.ACTION_REQUESTED, "command", {
    context: { ...context(pair.game), actorId: "foreign-player" },
    actionId: "observe", parameters: {}, expectedRevision: pair.game.revision,
  }, { target: GAME, subject: "actor/foreign-player" })
  assert.equal(pair.messages.at(-1).type, TYPES.ERROR)
  assert.equal(pair.messages.at(-1).data.code, "actor_mismatch")

  const currentRevision = pair.game.revision
  await pair.control.emit(TYPES.ACTION_REQUESTED, "command", {
    context: context(pair.game), actionId: "observe", parameters: {}, expectedRevision: currentRevision - 1,
  }, { target: GAME, subject: `actor/${ACTOR}` })
  assert.equal(pair.game.revision, currentRevision)
  assert.equal(pair.messages.at(-1).data.code, "revision_conflict")
})

test("browser game fails closed on corrupt persisted state", () => {
  const storage = new MemoryStorage()
  storage.setItem("evolution-sandbox.esip.browser.v1", "{not-json")
  assert.throws(() => createBrowserEvolutionAdapter({ pack, storage }), (error) => error.code === "invalid_storage")
})
