// SPDX-License-Identifier: GPL-3.0-or-later

import { randomUUID } from "node:crypto"
import { TYPES, createMessage } from "../src/interop/index.mjs"

const [operation, actorId, actionId] = process.argv.slice(2)
if (!operation || !actorId || !["state", "action"].includes(operation) || (operation === "action" && !actionId)) {
  console.error("Usage:")
  console.error("  npm run sidecar:client -- state <online-player>")
  console.error("  npm run sidecar:client -- action <online-player> <action-id>")
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

async function publish(message) {
  await api("/v1/commands", { method: "POST", body: message })
}

function responseCommandId(message) {
  if (message.type === TYPES.ACTION_APPLIED) return message.data.commandId
  if (message.type === TYPES.STATE_SNAPSHOT || message.type === TYPES.ERROR) return message.data.respondingTo
}

async function waitFor(commandId, timeoutMs = 15_000) {
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

const snapshot = await readState()
if (operation === "state") {
  console.log(JSON.stringify(snapshot.data, null, 2))
} else {
  const context = snapshot.data.context
  const command = envelope({
    type: TYPES.ACTION_REQUESTED,
    kind: "command",
    data: {
      context,
      actionId,
      parameters: {},
      expectedRevision: snapshot.data.revision,
    },
  })
  await publish(command)
  const result = await waitFor(command.id)
  console.log(JSON.stringify(result.data, null, 2))
}
