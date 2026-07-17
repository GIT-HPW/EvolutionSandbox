// SPDX-License-Identifier: GPL-3.0-or-later

import { timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { EsipError } from "./errors.mjs"
import { TYPES } from "./message-types.mjs"
import { validateMessage } from "./validation.mjs"

const COMMAND_TYPES = new Set([TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED])
const LUANTI_TYPES = new Set([
  TYPES.CAPABILITY_HELLO,
  TYPES.ACTION_APPLIED,
  TYPES.STATE_SNAPSHOT,
  TYPES.REALM_TRANSITIONED,
  TYPES.ERROR,
])
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"])
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function fingerprint(message) {
  return JSON.stringify(canonicalize(message))
}

function clone(value) {
  return structuredClone(value)
}

function requireAbsoluteUri(value, name) {
  if (typeof value !== "string" || value.length > 255) throw new TypeError(`${name} must be an absolute URI`)
  let url
  try { url = new URL(value) } catch { throw new TypeError(`${name} must be an absolute URI`) }
  if (url.username || url.password) throw new TypeError(`${name} must not contain credentials`)
}

function parseBoundedInteger(value, fallback, { min, max }) {
  if (value === null || value === undefined || value === "") return fallback
  if (!/^\d+$/.test(String(value))) throw new EsipError("invalid_request", "query parameter must be an integer")
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new EsipError("invalid_request", `query parameter must be between ${min} and ${max}`)
  }
  return number
}

function bearerMatches(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false
  const provided = Buffer.from(header.slice(7), "utf8")
  const expected = Buffer.from(token, "utf8")
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

async function readJson(request, maxBytes) {
  const declared = Number(request.headers["content-length"] ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new EsipError("message_too_large", `request exceeds ${maxBytes} bytes`)
  }
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new EsipError("message_too_large", `request exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  if (bytes === 0) throw new EsipError("invalid_request", "JSON request body is required")
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new EsipError("invalid_request", "request body must be valid JSON")
  }
}

function statusFor(error) {
  switch (error.code) {
    case "forbidden": return 403
    case "expired": return 410
    case "id_conflict":
    case "sequence_replay": return 409
    case "message_too_large": return 413
    case "queue_full": return 429
    default: return 400
  }
}

function writeJson(response, status, body) {
  const serialized = JSON.stringify(body)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  response.end(serialized)
}

function respondingTo(message) {
  if (message.type === TYPES.ACTION_APPLIED) return message.data.commandId
  if (message.type === TYPES.STATE_SNAPSHOT || message.type === TYPES.ERROR) return message.data.respondingTo
  return undefined
}

export class HttpSidecar {
  #server
  #seen = new Map()
  #lastSequence = new Map()
  #commandIds = new Map()
  #commands = new Map()
  #results = []
  #cursor = 0

  constructor({
    token,
    host = "127.0.0.1",
    port = 7070,
    luantiSource = "esip://luanti/world-alpha",
    luantiAdapterId = "luanti-world-alpha",
    allowedCommandSources = ["esip://local/control"],
    maxMessageBytes = 64 * 1024,
    maxPendingCommands = 1000,
    maxResults = 1000,
    seenLimit = 10_000,
    leaseMs = 5000,
    maxCommandTtlMs = 60_000,
    now = () => Date.now(),
  } = {}) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      throw new TypeError("token must contain 32-256 URL-safe ASCII characters")
    }
    if (!LOOPBACK_HOSTS.has(host)) throw new TypeError("sidecar host must be 127.0.0.1 or ::1")
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("port must be between 0 and 65535")
    if (!Array.isArray(allowedCommandSources) || allowedCommandSources.length === 0) {
      throw new TypeError("allowedCommandSources must not be empty")
    }
    requireAbsoluteUri(luantiSource, "luantiSource")
    if (typeof luantiAdapterId !== "string" || !ID_PATTERN.test(luantiAdapterId)) {
      throw new TypeError("luantiAdapterId must be a valid ESIP identifier")
    }
    for (const commandSource of allowedCommandSources) requireAbsoluteUri(commandSource, "allowed command source")
    this.token = token
    this.host = host
    this.port = port
    this.luantiSource = luantiSource
    this.luantiAdapterId = luantiAdapterId
    this.allowedCommandSources = new Set(allowedCommandSources)
    this.maxMessageBytes = maxMessageBytes
    this.maxPendingCommands = maxPendingCommands
    this.maxResults = maxResults
    this.seenLimit = seenLimit
    this.leaseMs = leaseMs
    this.maxCommandTtlMs = maxCommandTtlMs
    this.now = now

    this.#server = createServer((request, response) => {
      this.#handle(request, response).catch((error) => {
        const known = error instanceof EsipError
        writeJson(response, known ? statusFor(error) : 500, {
          error: {
            code: known ? error.code : "internal_error",
            message: known ? error.message : "internal sidecar error",
            retryable: known ? error.code === "queue_full" : true,
          },
        })
      })
    })
    this.#server.headersTimeout = 5000
    this.#server.requestTimeout = 10_000
    this.#server.keepAliveTimeout = 5000
  }

  #accept(message) {
    const seenKey = message.source + "\u0000" + message.id
    const current = fingerprint(message)
    const previous = this.#seen.get(seenKey)
    if (previous !== undefined) {
      if (previous !== current) throw new EsipError("id_conflict", "message id was reused with different content")
      return false
    }
    const last = this.#lastSequence.get(message.source)
    if (last !== undefined && message.sequence <= last) {
      throw new EsipError("sequence_replay", `sequence ${message.sequence} is not newer than ${last}`)
    }
    this.#seen.set(seenKey, current)
    while (this.#seen.size > this.seenLimit) this.#seen.delete(this.#seen.keys().next().value)
    this.#lastSequence.set(message.source, message.sequence)
    return true
  }

  enqueueCommand(rawMessage) {
    const message = validateMessage(clone(rawMessage), { now: this.now() })
    if (!COMMAND_TYPES.has(message.type) || (message.kind !== "command" && message.kind !== "query")) {
      throw new EsipError("forbidden", "only action commands and state queries may enter the Luanti queue")
    }
    if (!this.allowedCommandSources.has(message.source)) throw new EsipError("forbidden", "command source is not allowed")
    if (message.target !== this.luantiSource) throw new EsipError("forbidden", "command target is not the configured Luanti source")
    if (!message.expiresat) throw new EsipError("invalid_message", "sidecar commands require expiresat")
    if (Date.parse(message.expiresat) > this.now() + this.maxCommandTtlMs) {
      throw new EsipError("invalid_message", `command expiry must be within ${this.maxCommandTtlMs} ms`)
    }
    const currentFingerprint = fingerprint(message)
    const previousCommand = this.#commandIds.get(message.id)
    if (previousCommand) {
      if (previousCommand.source !== message.source || previousCommand.fingerprint !== currentFingerprint) {
        throw new EsipError("id_conflict", "command id was already used by a different message")
      }
      return { accepted: false, duplicate: true, id: message.id }
    }
    if (this.#commands.size >= this.maxPendingCommands) throw new EsipError("queue_full", "pending command queue is full")
    const accepted = this.#accept(message)
    if (!accepted) return { accepted: false, duplicate: true, id: message.id }
    this.#commandIds.set(message.id, { source: message.source, fingerprint: currentFingerprint })
    while (this.#commandIds.size > this.seenLimit) this.#commandIds.delete(this.#commandIds.keys().next().value)
    this.#commands.set(message.id, { message, leaseUntil: 0, attempts: 0 })
    return { accepted: true, duplicate: false, id: message.id }
  }

  leaseCommands(target, limit = 4) {
    if (target !== this.luantiSource && target !== this.luantiAdapterId) {
      throw new EsipError("forbidden", "poll target is not the configured Luanti adapter")
    }
    const instant = this.now()
    const messages = []
    for (const [id, entry] of this.#commands) {
      if (Date.parse(entry.message.expiresat) <= instant) {
        this.#commands.delete(id)
        continue
      }
      if (entry.leaseUntil > instant) continue
      entry.leaseUntil = instant + this.leaseMs
      entry.attempts += 1
      messages.push(clone(entry.message))
      if (messages.length >= limit) break
    }
    return messages
  }

  acceptLuantiMessage(rawMessage) {
    const message = validateMessage(clone(rawMessage), { now: this.now() })
    if (message.source !== this.luantiSource) throw new EsipError("forbidden", "message source is not the configured Luanti source")
    if (!LUANTI_TYPES.has(message.type) || (message.kind !== "event" && message.kind !== "result")) {
      throw new EsipError("forbidden", "Luanti may only publish declared events and results")
    }
    if (message.type === TYPES.CAPABILITY_HELLO && message.data.adapterId !== this.luantiAdapterId) {
      throw new EsipError("forbidden", "capability adapterId does not match the configured Luanti adapter")
    }
    if (message.type === TYPES.CAPABILITY_HELLO && message.target !== undefined) {
      throw new EsipError("forbidden", "capability announcement must not target a control adapter")
    }
    if (message.type !== TYPES.CAPABILITY_HELLO && !this.allowedCommandSources.has(message.target)) {
      throw new EsipError("forbidden", "Luanti result target is not an allowed control source")
    }
    const accepted = this.#accept(message)
    if (!accepted) return { accepted: false, duplicate: true, id: message.id }
    const commandId = respondingTo(message)
    if (commandId) this.#commands.delete(commandId)
    this.#cursor += 1
    this.#results.push({ cursor: this.#cursor, message })
    while (this.#results.length > this.maxResults) this.#results.shift()
    return { accepted: true, duplicate: false, id: message.id, cursor: this.#cursor }
  }

  listResults(after = 0, limit = 100) {
    const entries = this.#results.filter((entry) => entry.cursor > after).slice(0, limit).map(clone)
    return {
      entries,
      nextCursor: entries.at(-1)?.cursor ?? after,
      latestCursor: this.#cursor,
      oldestCursor: this.#results[0]?.cursor ?? this.#cursor,
    }
  }

  stats() {
    return {
      status: "ok",
      protocol: "ESIP 0.1",
      luantiSource: this.luantiSource,
      pendingCommands: this.#commands.size,
      retainedResults: this.#results.length,
      latestCursor: this.#cursor,
    }
  }

  async #handle(request, response) {
    const url = new URL(request.url ?? "/", "http://sidecar.local")
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, this.stats())
      return
    }
    if (!url.pathname.startsWith("/v1/") || !bearerMatches(request.headers.authorization, this.token)) {
      writeJson(response, 401, { error: { code: "unauthorized", message: "valid bearer token required", retryable: false } })
      return
    }
    if (request.method === "POST" && !String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      throw new EsipError("invalid_request", "content-type must be application/json")
    }

    if (request.method === "POST" && url.pathname === "/v1/commands") {
      const result = this.enqueueCommand(await readJson(request, this.maxMessageBytes))
      writeJson(response, 202, result)
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/commands") {
      const target = url.searchParams.get("target") ?? ""
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 4, { min: 1, max: 8 })
      writeJson(response, 200, { messages: this.leaseCommands(target, limit) })
      return
    }
    if (request.method === "POST" && url.pathname === "/v1/messages") {
      const result = this.acceptLuantiMessage(await readJson(request, this.maxMessageBytes))
      writeJson(response, 202, result)
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/results") {
      const after = parseBoundedInteger(url.searchParams.get("after"), 0, { min: 0, max: Number.MAX_SAFE_INTEGER })
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 100, { min: 1, max: 500 })
      writeJson(response, 200, this.listResults(after, limit))
      return
    }
    writeJson(response, 404, { error: { code: "not_found", message: "endpoint not found", retryable: false } })
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      this.#server.once("error", onError)
      this.#server.listen(this.port, this.host, () => {
        this.#server.off("error", onError)
        const address = this.#server.address()
        resolve({ host: this.host, port: typeof address === "object" && address ? address.port : this.port })
      })
    })
  }

  close() {
    return new Promise((resolve, reject) => {
      if (!this.#server.listening) {
        resolve()
        return
      }
      this.#server.close((error) => error ? reject(error) : resolve())
    })
  }
}

export function createHttpSidecar(options) {
  return new HttpSidecar(options)
}
