// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { TYPES, createHttpSidecar, createMessage } from "../src/interop/index.mjs"

const TOKEN = "test-token-" + "x".repeat(48)
const CONTROL = "esip://local/control"
const LUANTI = "esip://luanti/world-alpha"
const NOW = new Date("2026-07-17T08:00:00.000Z")

function stateRequest({ id = "query-1", sequence = 1, expiresInMs = 30_000, source = CONTROL } = {}) {
  return createMessage({
    id,
    source,
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

function stateSnapshot({ id = "result-1", sequence = 1, respondingTo = "query-1" } = {}) {
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
        energy: 24, information: 0, entropy: 0, stability: 12,
        fragments: 0, timeline: "origin", steps: 0,
      },
    },
  }, { now: () => NOW })
}

async function withSidecar(run, options = {}) {
  let clock = NOW.getTime()
  const sidecar = createHttpSidecar({
    token: TOKEN,
    port: 0,
    now: () => clock,
    ...options,
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
  try {
    await run({ sidecar, api, advance: (milliseconds) => { clock += milliseconds } })
  } finally {
    await sidecar.close()
  }
}

test("HTTP sidecar completes a leased Luanti state-query round trip", async () => {
  await withSidecar(async ({ api, advance }) => {
    const health = await api("/health", { token: "" })
    assert.equal(health.response.status, 200)
    assert.equal(health.payload.pendingCommands, 0)

    const unauthorized = await api("/v1/commands", { method: "POST", body: stateRequest(), token: "wrong" })
    assert.equal(unauthorized.response.status, 401)

    const queued = await api("/v1/commands", { method: "POST", body: stateRequest() })
    assert.equal(queued.response.status, 202)
    assert.equal(queued.payload.accepted, true)

    const duplicate = await api("/v1/commands", { method: "POST", body: stateRequest() })
    assert.equal(duplicate.response.status, 202)
    assert.equal(duplicate.payload.duplicate, true)

    const firstPoll = await api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(firstPoll.response.status, 200)
    assert.equal(firstPoll.payload.messages.length, 1)
    assert.equal(firstPoll.payload.messages[0].id, "query-1")

    const leasedPoll = await api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(leasedPoll.payload.messages.length, 0)
    advance(5001)
    const redelivery = await api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(redelivery.payload.messages[0].id, "query-1")

    const acceptedResult = await api("/v1/messages", { method: "POST", body: stateSnapshot() })
    assert.equal(acceptedResult.response.status, 202)
    assert.equal(acceptedResult.payload.cursor, 1)

    const completedPoll = await api(`/v1/commands?target=${encodeURIComponent(LUANTI)}&limit=4`)
    assert.equal(completedPoll.payload.messages.length, 0)
    const results = await api("/v1/results?after=0&limit=10")
    assert.equal(results.payload.entries.length, 1)
    assert.equal(results.payload.entries[0].message.data.respondingTo, "query-1")

    const duplicateResult = await api("/v1/messages", { method: "POST", body: stateSnapshot() })
    assert.equal(duplicateResult.payload.duplicate, true)
    const unchanged = await api("/v1/results?after=0&limit=10")
    assert.equal(unchanged.payload.entries.length, 1)
  })
})

test("HTTP sidecar rejects wrong targets, replayed sequences and excessive command TTL", async () => {
  await withSidecar(async ({ api }) => {
    const wrongTarget = { ...stateRequest(), target: "esip://luanti/other" }
    const wrongTargetResult = await api("/v1/commands", { method: "POST", body: wrongTarget })
    assert.equal(wrongTargetResult.response.status, 403)

    const longLived = stateRequest({ id: "query-long", sequence: 2, expiresInMs: 120_000 })
    const longLivedResult = await api("/v1/commands", { method: "POST", body: longLived })
    assert.equal(longLivedResult.response.status, 400)
    assert.equal(longLivedResult.payload.error.code, "invalid_message")

    const accepted = await api("/v1/commands", { method: "POST", body: stateRequest({ id: "query-a", sequence: 3 }) })
    assert.equal(accepted.response.status, 202)
    const replay = await api("/v1/commands", { method: "POST", body: stateRequest({ id: "query-b", sequence: 3 }) })
    assert.equal(replay.response.status, 409)
    assert.equal(replay.payload.error.code, "sequence_replay")

    const wrongPoll = await api(`/v1/commands?target=${encodeURIComponent("esip://luanti/other")}`)
    assert.equal(wrongPoll.response.status, 403)
  })
})

test("HTTP sidecar keeps command ids unambiguous across allowed sources", async () => {
  const secondSource = "esip://local/second-control"
  await withSidecar(async ({ api }) => {
    const first = await api("/v1/commands", { method: "POST", body: stateRequest({ id: "shared-id", sequence: 10 }) })
    assert.equal(first.response.status, 202)
    const conflict = await api("/v1/commands", {
      method: "POST",
      body: stateRequest({ id: "shared-id", sequence: 11, source: secondSource }),
    })
    assert.equal(conflict.response.status, 409)
    assert.equal(conflict.payload.error.code, "id_conflict")
  }, { allowedCommandSources: [CONTROL, secondSource] })
})

test("HTTP sidecar refuses non-loopback binding and short tokens", () => {
  assert.throws(() => createHttpSidecar({ token: TOKEN, host: "0.0.0.0" }), /host must/)
  assert.throws(() => createHttpSidecar({ token: "short" }), /32-256/)
  assert.throws(() => createHttpSidecar({ token: "x".repeat(32) + "\r\n" }), /URL-safe/)
})
