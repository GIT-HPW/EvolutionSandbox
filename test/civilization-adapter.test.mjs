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
} from "../src/interop/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tidal = JSON.parse(await readFile(resolve(root, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"))
const ENGINE = "esip://evolution/civilization-alpha"
const CLIENT = "esip://local/civilization-control"

function context(timelineId = "origin") {
  return { universeId: "universe-1", timelineId, actorId: "actor-42" }
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
