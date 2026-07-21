// SPDX-License-Identifier: GPL-3.0-or-later

import { randomUUID } from "node:crypto"
import { TYPES, createMessage } from "../src/interop/index.mjs"

const [operation, actorId, argument] = process.argv.slice(2)
const operations = new Set(["diagnostics", "state", "action", "timelines", "create-timeline", "join-timeline"])
if (!operation || !operations.has(operation) || (operation !== "diagnostics" && !actorId)
    || (["action", "create-timeline", "join-timeline"].includes(operation) && !argument)) {
  console.error("Usage:")
  console.error("  npm run sidecar:client -- diagnostics")
  console.error("  npm run sidecar:client -- state <actor-id>")
  console.error("  npm run sidecar:client -- action <actor-id> <action-id>")
  console.error("  npm run sidecar:client -- timelines <actor-id> [after-revision]")
  console.error("  npm run sidecar:client -- create-timeline <actor-id> <timeline-id>")
  console.error("  npm run sidecar:client -- join-timeline <actor-id> <timeline-id>")
  process.exit(2)
}

const token = process.env.EVOLUTION_ESIP_TOKEN
if (!token || !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) {
  throw new Error("EVOLUTION_ESIP_TOKEN must contain 32-256 URL-safe ASCII characters")
}

const baseUrl = process.env.ESIP_SIDECAR_URL || "http://127.0.0.1:7070"
const source = process.env.ESIP_CONTROL_SOURCE || "esip://local/control"
const target = process.env.ESIP_LUANTI_SOURCE || "esip://luanti/world-alpha"
const universeId = process.env.ESIP_UNIVERSE_ID || "universe-1"
let sequence = Date.now() * 1000
let cursor = 0
const responseTimeoutMs = Number(process.env.ESIP_CLIENT_TIMEOUT_MS || 15_000)
if (!Number.isSafeInteger(responseTimeoutMs) || responseTimeoutMs < 1000 || responseTimeoutMs > 300_000) {
  throw new Error("ESIP_CLIENT_TIMEOUT_MS must be an integer between 1000 and 300000")
}

function nextSequence() {
  sequence += 1
  return sequence
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${payload.error?.code ?? response.status}: ${payload.error?.message ?? response.statusText}`)
  return payload
}

if (operation === "diagnostics") {
  console.log(JSON.stringify(await api("/v1/diagnostics"), null, 2))
  process.exit(0)
}

async function publish(message) {
  await api("/v1/commands", { method: "POST", body: message })
}

function responseCommandId(message) {
  if ([TYPES.ACTION_APPLIED, TYPES.TIMELINE_CREATED_V2, TYPES.TIMELINE_JOINED].includes(message.type)) return message.data.commandId
  if ([TYPES.STATE_SNAPSHOT, TYPES.TIMELINE_REGISTRY_SNAPSHOT, TYPES.ERROR].includes(message.type)) return message.data.respondingTo
}

async function waitFor(commandId, timeoutMs = responseTimeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await api(`/v1/results?after=${cursor}&limit=100`)
    cursor = result.nextCursor
    for (const entry of result.entries) {
      if (responseCommandId(entry.message) !== commandId) continue
      if (entry.message.type === TYPES.ERROR) {
        throw new Error(`${entry.message.data.code}: ${entry.message.data.message}`)
      }
      return entry.message
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`timed out waiting for Luanti response to ${commandId}`)
}

function envelope(input) {
  const now = new Date()
  return createMessage({
    id: randomUUID(),
    source,
    target,
    sequence: nextSequence(),
    subject: `actor/${actorId}`,
    expiresat: new Date(now.getTime() + 30_000).toISOString(),
    ...input,
  }, { now: () => now })
}

async function readState() {
  const request = envelope({
    type: TYPES.STATE_REQUESTED,
    kind: "query",
    data: {
      context: { universeId, timelineId: "origin", actorId },
      fields: ["phase", "dimension", "energy", "information", "entropy", "stability", "fragments", "timeline", "steps"],
    },
  })
  await publish(request)
  return waitFor(request.id)
}

async function readRegistry(context, afterRevision = 0) {
  const request = envelope({
    type: TYPES.TIMELINE_REGISTRY_REQUESTED,
    kind: "query",
    data: { context, afterRevision },
  })
  await publish(request)
  return waitFor(request.id)
}

const snapshot = await readState()
if (operation === "state") {
  console.log(JSON.stringify(snapshot.data, null, 2))
} else if (operation === "action") {
  const context = snapshot.data.context
  const command = envelope({
    type: TYPES.ACTION_REQUESTED,
    kind: "command",
    data: {
      context,
      actionId: argument,
      parameters: {},
      expectedRevision: snapshot.data.revision,
    },
  })
  await publish(command)
  const result = await waitFor(command.id)
  console.log(JSON.stringify(result.data, null, 2))
} else {
  const context = snapshot.data.context
  const afterRevision = operation === "timelines" && argument !== undefined ? Number(argument) : 0
  if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) throw new Error("after-revision must be a non-negative integer")
  const registry = await readRegistry(context, afterRevision)
  if (registry.data.events === null) registry.data.events = []
  if (operation === "timelines") {
    console.log(JSON.stringify(registry.data, null, 2))
  } else {
    const creating = operation === "create-timeline"
    const command = envelope({
      type: creating ? TYPES.TIMELINE_CREATE_REQUESTED : TYPES.TIMELINE_JOIN_REQUESTED,
      kind: "command",
      data: {
        context,
        ...(creating ? { newTimelineId: argument } : { targetTimelineId: argument }),
        expectedStateRevision: snapshot.data.revision,
        expectedRegistryRevision: registry.data.registryRevision,
      },
    })
    await publish(command)
    const result = await waitFor(command.id)
    console.log(JSON.stringify(result.data, null, 2))
  }
}
