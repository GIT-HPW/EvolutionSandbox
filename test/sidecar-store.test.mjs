// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  TYPES,
  createHttpSidecar,
  createJournalSidecarStore,
  createMessage,
} from "../src/interop/index.mjs"

const TOKEN = "persistent-test-token-" + "x".repeat(40)
const CONTROL = "esip://local/control"
const SECOND_CONTROL = "esip://local/second-control"
const LUANTI = "esip://luanti/world-alpha"
const ADAPTER = "luanti-world-alpha"
const NOW = new Date("2026-07-21T08:00:00.000Z")
const BINDING = {
  luantiSource: LUANTI,
  luantiAdapterId: ADAPTER,
  allowedCommandSources: [CONTROL],
}

function stateRequest({ id = "query-1", sequence = 1, expiresInMs = 30_000 } = {}) {
  return createMessage({
    id,
    source: CONTROL,
    target: LUANTI,
    type: TYPES.STATE_REQUESTED,
    kind: "query",
    sequence,
    expiresat: new Date(NOW.getTime() + expiresInMs).toISOString(),
    subject: "actor/test-player",
    data: {
      context: { universeId: "universe-1", timelineId: "origin", actorId: "test-player" },
      fields: ["phase", "dimension"],
    },
  }, { now: () => NOW })
}

function stateSnapshot({ id = "result-1", sequence = 1, respondingTo = "query-1", energy = 24 } = {}) {
  return createMessage({
    id,
    source: LUANTI,
    target: CONTROL,
    type: TYPES.STATE_SNAPSHOT,
    kind: "result",
    sequence,
    subject: "actor/test-player",
    correlationid: respondingTo,
    causationid: respondingTo,
    data: {
      context: {
        universeId: "universe-1", timelineId: "origin", realmId: "origin_0d", actorId: "test-player",
      },
      respondingTo,
      revision: 0,
      state: {
        schema: "evolution-state/v1", phase: "origin_0d", dimension: 0,
        energy, information: 0, entropy: 0, stability: 12,
        fragments: 0, timeline: "origin", steps: 0,
      },
    },
  }, { now: () => NOW })
}

async function startPersistentSidecar(directory, clock, { checkpointEvery = 1000 } = {}) {
  const sidecar = createHttpSidecar({
    token: TOKEN,
    port: 0,
    now: () => clock.value,
    store: createJournalSidecarStore({ directory, checkpointEvery }),
  })
  const address = await sidecar.listen()
  const baseUrl = `http://${address.host}:${address.port}`
  async function api(path, { method = "GET", body, token = TOKEN } = {}) {
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { response, payload: await response.json() }
  }
  return { sidecar, api }
}

test("persistent sidecar recovers a command that was accepted before leasing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-sidecar-before-lease-"))
  const clock = { value: NOW.getTime() }
  let running
  try {
    running = await startPersistentSidecar(directory, clock)
    const queued = await running.api("/v1/commands", { method: "POST", body: stateRequest() })
    assert.equal(queued.response.status, 202)
    assert.equal(queued.payload.accepted, true)
    await running.sidecar.close()

    running = await startPersistentSidecar(directory, clock)
    const recovered = await running.api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(recovered.response.status, 200)
    assert.deepEqual(recovered.payload.messages.map((message) => message.id), ["query-1"])
    const diagnostics = await running.api("/v1/diagnostics")
    assert.equal(diagnostics.payload.storage.kind, "journal")
    assert.equal(diagnostics.payload.pendingCommands, 1)
    assert.equal(diagnostics.payload.leasedCommands, 1)
  } finally {
    await running?.sidecar.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("persistent sidecar reclaims an expired lease and keeps results, cursor and idempotency across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-sidecar-lease-"))
  const clock = { value: NOW.getTime() }
  let running
  try {
    running = await startPersistentSidecar(directory, clock)
    await running.api("/v1/commands", { method: "POST", body: stateRequest() })
    const firstLease = await running.api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(firstLease.payload.messages.length, 1)
    await running.sidecar.close()

    running = await startPersistentSidecar(directory, clock)
    const stillLeased = await running.api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(stillLeased.payload.messages.length, 0)
    clock.value += 5001
    const reclaimed = await running.api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.deepEqual(reclaimed.payload.messages.map((message) => message.id), ["query-1"])
    const afterReclaim = await running.api("/v1/diagnostics")
    assert.equal(afterReclaim.payload.totalLeaseAttempts, 2)
    assert.equal(afterReclaim.payload.maxLeaseAttempts, 2)
    const result = await running.api("/v1/messages", { method: "POST", body: stateSnapshot() })
    assert.equal(result.payload.cursor, 1)
    await running.sidecar.close()

    running = await startPersistentSidecar(directory, clock)
    const noPending = await running.api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(noPending.payload.messages.length, 0)
    const retained = await running.api("/v1/results?after=0&limit=10")
    assert.equal(retained.payload.latestCursor, 1)
    assert.equal(retained.payload.entries[0].message.id, "result-1")

    const duplicateCommand = await running.api("/v1/commands", { method: "POST", body: stateRequest() })
    assert.equal(duplicateCommand.response.status, 202)
    assert.equal(duplicateCommand.payload.duplicate, true)
    const replayedCommandSequence = await running.api("/v1/commands", {
      method: "POST",
      body: stateRequest({ id: "query-replayed-sequence", sequence: 1 }),
    })
    assert.equal(replayedCommandSequence.response.status, 409)
    assert.equal(replayedCommandSequence.payload.error.code, "sequence_replay")
    const duplicateResult = await running.api("/v1/messages", { method: "POST", body: stateSnapshot() })
    assert.equal(duplicateResult.response.status, 202)
    assert.equal(duplicateResult.payload.duplicate, true)
    const conflictingResult = await running.api("/v1/messages", {
      method: "POST",
      body: stateSnapshot({ energy: 25 }),
    })
    assert.equal(conflictingResult.response.status, 409)
    assert.equal(conflictingResult.payload.error.code, "id_conflict")

    const secondResult = await running.api("/v1/messages", {
      method: "POST",
      body: stateSnapshot({ id: "result-2", sequence: 2, respondingTo: "query-2" }),
    })
    assert.equal(secondResult.payload.cursor, 2)
    await running.sidecar.close()

    running = await startPersistentSidecar(directory, clock)
    const monotonic = await running.api("/v1/results?after=1&limit=10")
    assert.equal(monotonic.payload.latestCursor, 2)
    assert.deepEqual(monotonic.payload.entries.map((entry) => entry.cursor), [2])
    const replayedResultSequence = await running.api("/v1/messages", {
      method: "POST",
      body: stateSnapshot({ id: "result-replayed-sequence", sequence: 2, respondingTo: "query-3" }),
    })
    assert.equal(replayedResultSequence.response.status, 409)
    assert.equal(replayedResultSequence.payload.error.code, "sequence_replay")
  } finally {
    await running?.sidecar.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("expired commands are removed durably during recovery polling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-sidecar-expired-"))
  const clock = { value: NOW.getTime() }
  let running
  try {
    running = await startPersistentSidecar(directory, clock)
    await running.api("/v1/commands", {
      method: "POST",
      body: stateRequest({ expiresInMs: 1000 }),
    })
    await running.sidecar.close()

    clock.value += 1001
    running = await startPersistentSidecar(directory, clock)
    const poll = await running.api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(poll.payload.messages.length, 0)
    const cleaned = await running.api("/v1/diagnostics")
    assert.equal(cleaned.payload.pendingCommands, 0)
    await running.sidecar.close()

    running = await startPersistentSidecar(directory, clock)
    const afterRestart = await running.api("/v1/diagnostics")
    assert.equal(afterRestart.payload.pendingCommands, 0)
  } finally {
    await running?.sidecar.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("persistent store refuses a changed binding and corrupt journal instead of clearing state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-sidecar-corrupt-journal-"))
  try {
    const store = createJournalSidecarStore({ directory, checkpointEvery: 1000 })
    await store.initialize(BINDING)
    const message = stateRequest()
    await store.enqueueCommand(message, {
      fingerprint: JSON.stringify(message),
      maxPendingCommands: 100,
      seenLimit: 100,
    })

    const changed = createJournalSidecarStore({ directory })
    await assert.rejects(changed.initialize({
      ...BINDING,
      allowedCommandSources: [CONTROL, SECOND_CONTROL],
    }), /binding does not match/)

    await appendFile(join(directory, "journal.jsonl"), "{truncated\n", "utf8")
    const corrupted = createJournalSidecarStore({ directory })
    await assert.rejects(corrupted.initialize(BINDING), /journal line 2 is not valid JSON/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("persistent store validates checkpoint checksums and never silently resets them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-sidecar-corrupt-checkpoint-"))
  try {
    const store = createJournalSidecarStore({ directory, checkpointEvery: 1 })
    await store.initialize(BINDING)
    const message = stateRequest()
    await store.enqueueCommand(message, {
      fingerprint: JSON.stringify(message),
      maxPendingCommands: 100,
      seenLimit: 100,
    })
    const checkpointPath = join(directory, "checkpoint.json")
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"))
    checkpoint.state.cursor = 99
    await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8")

    const corrupted = createJournalSidecarStore({ directory })
    await assert.rejects(corrupted.initialize(BINDING), /checkpoint checksum mismatch/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("persistent store refuses a journal whose checkpoint is missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-sidecar-missing-checkpoint-"))
  try {
    const store = createJournalSidecarStore({ directory, checkpointEvery: 1000 })
    await store.initialize(BINDING)
    const message = stateRequest()
    await store.enqueueCommand(message, {
      fingerprint: JSON.stringify(message),
      maxPendingCommands: 100,
      seenLimit: 100,
    })
    await rm(join(directory, "checkpoint.json"))

    const incomplete = createJournalSidecarStore({ directory })
    await assert.rejects(incomplete.initialize(BINDING), /checkpoint is missing while journal contains data/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
