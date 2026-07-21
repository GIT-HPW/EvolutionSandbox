// SPDX-License-Identifier: GPL-3.0-or-later

import { timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { EsipError } from "./errors.mjs"
import { TYPES } from "./message-types.mjs"
import { MemorySidecarStore, SidecarStore } from "./sidecar-store.mjs"
import { validateMessage } from "./validation.mjs"

const COMMAND_TYPES = new Set([
  TYPES.ACTION_REQUESTED,
  TYPES.STATE_REQUESTED,
  TYPES.TIMELINE_CREATE_REQUESTED,
  TYPES.TIMELINE_JOIN_REQUESTED,
  TYPES.TIMELINE_REGISTRY_REQUESTED,
])
const LUANTI_TYPES = new Set([
  TYPES.CAPABILITY_HELLO,
  TYPES.ACTION_APPLIED,
  TYPES.STATE_SNAPSHOT,
  TYPES.REALM_TRANSITIONED,
  TYPES.TIMELINE_CREATED_V2,
  TYPES.TIMELINE_JOINED,
  TYPES.TIMELINE_REGISTRY_SNAPSHOT,
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

function requireIntegerOption(value, name, { min, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`)
  }
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
  if ([TYPES.ACTION_APPLIED, TYPES.TIMELINE_CREATED_V2, TYPES.TIMELINE_JOINED].includes(message.type)) return message.data.commandId
  if ([TYPES.STATE_SNAPSHOT, TYPES.TIMELINE_REGISTRY_SNAPSHOT, TYPES.ERROR].includes(message.type)) return message.data.respondingTo
  return undefined
}

export class HttpSidecar {
  #server

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
    store = new MemorySidecarStore(),
  } = {}) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      throw new TypeError("token must contain 32-256 URL-safe ASCII characters")
    }
    if (!LOOPBACK_HOSTS.has(host)) throw new TypeError("sidecar host must be 127.0.0.1 or ::1")
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError("port must be between 0 and 65535")
    if (!Array.isArray(allowedCommandSources) || allowedCommandSources.length === 0) {
      throw new TypeError("allowedCommandSources must not be empty")
    }
    requireIntegerOption(maxMessageBytes, "maxMessageBytes", { min: 1024, max: 4 * 1024 * 1024 })
    requireIntegerOption(maxPendingCommands, "maxPendingCommands", { min: 1, max: 1_000_000 })
    requireIntegerOption(maxResults, "maxResults", { min: 1, max: 1_000_000 })
    requireIntegerOption(seenLimit, "seenLimit", { min: 1, max: 1_000_000 })
    requireIntegerOption(leaseMs, "leaseMs", { min: 100, max: 300_000 })
    requireIntegerOption(maxCommandTtlMs, "maxCommandTtlMs", { min: 1000, max: 3_600_000 })
    if (typeof now !== "function") throw new TypeError("now must be a function")
    requireAbsoluteUri(luantiSource, "luantiSource")
    if (typeof luantiAdapterId !== "string" || !ID_PATTERN.test(luantiAdapterId)) {
      throw new TypeError("luantiAdapterId must be a valid ESIP identifier")
    }
    for (const commandSource of allowedCommandSources) requireAbsoluteUri(commandSource, "allowed command source")
    if (!(store instanceof SidecarStore)) throw new TypeError("store must implement SidecarStore")
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
    this.store = store

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

  async enqueueCommand(rawMessage) {
    const message = validateMessage(clone(rawMessage), { now: this.now() })
    if (!COMMAND_TYPES.has(message.type) || (message.kind !== "command" && message.kind !== "query")) {
      throw new EsipError("forbidden", "only declared Evolution commands and queries may enter the Luanti queue")
    }
    if (!this.allowedCommandSources.has(message.source)) throw new EsipError("forbidden", "command source is not allowed")
    if (message.target !== this.luantiSource) throw new EsipError("forbidden", "command target is not the configured Luanti source")
    if (!message.expiresat) throw new EsipError("invalid_message", "sidecar commands require expiresat")
    if (Date.parse(message.expiresat) > this.now() + this.maxCommandTtlMs) {
      throw new EsipError("invalid_message", `command expiry must be within ${this.maxCommandTtlMs} ms`)
    }
    const currentFingerprint = fingerprint(message)
    return this.store.enqueueCommand(message, {
      fingerprint: currentFingerprint,
      maxPendingCommands: this.maxPendingCommands,
      seenLimit: this.seenLimit,
    })
  }

  async leaseCommands(target, limit = 4) {
    if (target !== this.luantiSource && target !== this.luantiAdapterId) {
      throw new EsipError("forbidden", "poll target is not the configured Luanti adapter")
    }
    return this.store.leaseCommands({ now: this.now(), leaseMs: this.leaseMs, limit })
  }

  async acceptLuantiMessage(rawMessage) {
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
    const commandId = respondingTo(message)
    return this.store.acceptLuantiMessage(message, {
      fingerprint: fingerprint(message),
      commandId,
      maxResults: this.maxResults,
      seenLimit: this.seenLimit,
    })
  }

  async listResults(after = 0, limit = 100) {
    return this.store.listResults(after, limit)
  }

  async stats() {
    const diagnostics = await this.store.diagnostics(this.now())
    return {
      status: "ok",
      protocol: "ESIP 0.1",
      luantiSource: this.luantiSource,
      pendingCommands: diagnostics.pendingCommands,
      retainedResults: diagnostics.retainedResults,
      latestCursor: diagnostics.latestCursor,
      storage: diagnostics.storage,
    }
  }

  async #handle(request, response) {
    const url = new URL(request.url ?? "/", "http://sidecar.local")
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, await this.stats())
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
      const result = await this.enqueueCommand(await readJson(request, this.maxMessageBytes))
      writeJson(response, 202, result)
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/commands") {
      const target = url.searchParams.get("target") ?? ""
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 4, { min: 1, max: 8 })
      writeJson(response, 200, { messages: await this.leaseCommands(target, limit) })
      return
    }
    if (request.method === "POST" && url.pathname === "/v1/messages") {
      const result = await this.acceptLuantiMessage(await readJson(request, this.maxMessageBytes))
      writeJson(response, 202, result)
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/results") {
      const after = parseBoundedInteger(url.searchParams.get("after"), 0, { min: 0, max: Number.MAX_SAFE_INTEGER })
      const limit = parseBoundedInteger(url.searchParams.get("limit"), 100, { min: 1, max: 500 })
      writeJson(response, 200, await this.listResults(after, limit))
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/diagnostics") {
      writeJson(response, 200, await this.store.diagnostics(this.now()))
      return
    }
    writeJson(response, 404, { error: { code: "not_found", message: "endpoint not found", retryable: false } })
  }

  async listen() {
    await this.store.initialize({
      luantiSource: this.luantiSource,
      luantiAdapterId: this.luantiAdapterId,
      allowedCommandSources: [...this.allowedCommandSources],
    })
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

  async close() {
    if (this.#server.listening) {
      await new Promise((resolve, reject) => {
        this.#server.close((error) => error ? reject(error) : resolve())
      })
    }
    await this.store.close()
  }
}

export function createHttpSidecar(options) {
  return new HttpSidecar(options)
}
