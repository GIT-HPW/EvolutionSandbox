// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { EsipError } from "./errors.mjs"

export const SIDECAR_STATE_SCHEMA = "evolution-sidecar-store-state/v1"
export const SIDECAR_CHECKPOINT_SCHEMA = "evolution-sidecar-checkpoint/v1"
export const SIDECAR_JOURNAL_SCHEMA = "evolution-sidecar-journal/v1"
const MAX_FINGERPRINT_CHARACTERS = 8 * 1024 * 1024

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function clone(value) {
  return structuredClone(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function checksum(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function requireString(value, name, { min = 1, max = 4096 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error(`${name} must be a string between ${min} and ${max} characters`)
  }
  return value
}

function requireInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function normalizeBinding(binding) {
  if (!plainObject(binding)) throw new TypeError("sidecar store binding must be an object")
  const allowedCommandSources = binding.allowedCommandSources
  if (!Array.isArray(allowedCommandSources) || allowedCommandSources.length === 0) {
    throw new TypeError("sidecar store binding requires allowedCommandSources")
  }
  return {
    luantiSource: requireString(binding.luantiSource, "binding.luantiSource", { max: 255 }),
    luantiAdapterId: requireString(binding.luantiAdapterId, "binding.luantiAdapterId", { max: 128 }),
    allowedCommandSources: [...new Set(allowedCommandSources.map((value) =>
      requireString(value, "binding.allowedCommandSources entry", { max: 255 })))].sort(),
  }
}

function bindingMatches(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function emptyState(binding = null) {
  return {
    schema: SIDECAR_STATE_SCHEMA,
    revision: 0,
    binding,
    seen: new Map(),
    lastSequence: new Map(),
    commandIds: new Map(),
    commands: new Map(),
    results: [],
    cursor: 0,
  }
}

function cloneState(state) {
  return {
    schema: state.schema,
    revision: state.revision,
    binding: clone(state.binding),
    seen: new Map([...state.seen].map(([key, value]) => [key, value])),
    lastSequence: new Map([...state.lastSequence].map(([key, value]) => [key, value])),
    commandIds: new Map([...state.commandIds].map(([key, value]) => [key, clone(value)])),
    commands: new Map([...state.commands].map(([key, value]) => [key, clone(value)])),
    results: state.results.map(clone),
    cursor: state.cursor,
  }
}

function serializeState(state) {
  return {
    schema: SIDECAR_STATE_SCHEMA,
    revision: state.revision,
    binding: clone(state.binding),
    seen: [...state.seen].map(([key, fingerprint]) => ({ key, fingerprint })),
    lastSequence: [...state.lastSequence].map(([source, sequence]) => ({ source, sequence })),
    commandIds: [...state.commandIds].map(([id, value]) => ({ id, ...clone(value) })),
    commands: [...state.commands].map(([id, value]) => ({ id, ...clone(value) })),
    results: state.results.map(clone),
    cursor: state.cursor,
  }
}

function uniqueMap(items, keyOf, valueOf, name) {
  if (!Array.isArray(items)) throw new Error(`${name} must be an array`)
  const result = new Map()
  for (const item of items) {
    if (!plainObject(item)) throw new Error(`${name} entry must be an object`)
    const key = keyOf(item)
    if (result.has(key)) throw new Error(`${name} contains duplicate key ${key}`)
    result.set(key, valueOf(item))
  }
  return result
}

function deserializeState(raw) {
  if (!plainObject(raw) || raw.schema !== SIDECAR_STATE_SCHEMA) {
    throw new Error(`sidecar state schema must be ${SIDECAR_STATE_SCHEMA}`)
  }
  const binding = raw.binding === null ? null : normalizeBinding(raw.binding)
  const state = emptyState(binding)
  state.revision = requireInteger(raw.revision, "state.revision")
  state.cursor = requireInteger(raw.cursor, "state.cursor")
  state.seen = uniqueMap(raw.seen,
    (item) => requireString(item.key, "seen.key", { max: 512 }),
    (item) => requireString(item.fingerprint, "seen.fingerprint", { max: MAX_FINGERPRINT_CHARACTERS }), "seen")
  state.lastSequence = uniqueMap(raw.lastSequence,
    (item) => requireString(item.source, "lastSequence.source", { max: 255 }),
    (item) => requireInteger(item.sequence, "lastSequence.sequence"), "lastSequence")
  state.commandIds = uniqueMap(raw.commandIds,
    (item) => requireString(item.id, "commandIds.id", { max: 128 }),
    (item) => ({
      source: requireString(item.source, "commandIds.source", { max: 255 }),
      fingerprint: requireString(item.fingerprint, "commandIds.fingerprint", { max: MAX_FINGERPRINT_CHARACTERS }),
    }), "commandIds")
  state.commands = uniqueMap(raw.commands,
    (item) => requireString(item.id, "commands.id", { max: 128 }),
    (item) => {
      if (!plainObject(item.message)) throw new Error("commands.message must be an object")
      return {
        message: clone(item.message),
        leaseUntil: requireInteger(item.leaseUntil, "commands.leaseUntil"),
        attempts: requireInteger(item.attempts, "commands.attempts"),
      }
    }, "commands")
  if (!Array.isArray(raw.results)) throw new Error("state.results must be an array")
  let previousCursor = 0
  state.results = raw.results.map((entry) => {
    if (!plainObject(entry) || !plainObject(entry.message)) throw new Error("results entry must contain a message")
    const cursor = requireInteger(entry.cursor, "results.cursor", { min: 1 })
    if (cursor <= previousCursor || cursor > state.cursor) throw new Error("result cursors must be increasing and bounded")
    previousCursor = cursor
    return { cursor, message: clone(entry.message) }
  })
  for (const [id, entry] of state.commands) {
    if (entry.message.id !== id || typeof entry.message.source !== "string" || !Number.isFinite(Date.parse(entry.message.expiresat))) {
      throw new Error(`pending command ${id} has inconsistent message identity or expiry`)
    }
    const identity = state.commandIds.get(id)
    if (!identity || identity.source !== entry.message.source) {
      throw new Error(`pending command ${id} is missing its command identity record`)
    }
  }
  return state
}

function trimMap(map, limit) {
  while (map.size > limit) map.delete(map.keys().next().value)
}

function applyOperation(state, operation) {
  if (!plainObject(operation) || typeof operation.type !== "string") {
    throw new Error("journal operation must be an object with a type")
  }
  if (operation.type === "enqueue") {
    const { seenKey, fingerprint, source, sequence, commandId, commandSource, commandFingerprint, message } = operation
    state.seen.set(requireString(seenKey, "enqueue.seenKey", { max: 512 }),
      requireString(fingerprint, "enqueue.fingerprint", { max: MAX_FINGERPRINT_CHARACTERS }))
    state.lastSequence.set(requireString(source, "enqueue.source", { max: 255 }),
      requireInteger(sequence, "enqueue.sequence"))
    state.commandIds.set(requireString(commandId, "enqueue.commandId", { max: 128 }), {
      source: requireString(commandSource, "enqueue.commandSource", { max: 255 }),
      fingerprint: requireString(commandFingerprint, "enqueue.commandFingerprint", { max: MAX_FINGERPRINT_CHARACTERS }),
    })
    if (!plainObject(message)) throw new Error("enqueue.message must be an object")
    state.commands.set(commandId, { message: clone(message), leaseUntil: 0, attempts: 0 })
    trimMap(state.seen, requireInteger(operation.seenLimit, "enqueue.seenLimit", { min: 1 }))
    trimMap(state.commandIds, requireInteger(operation.seenLimit, "enqueue.seenLimit", { min: 1 }))
    return
  }
  if (operation.type === "lease") {
    if (!Array.isArray(operation.expiredIds) || !Array.isArray(operation.leases)) {
      throw new Error("lease operation must contain expiredIds and leases")
    }
    for (const id of operation.expiredIds) state.commands.delete(requireString(id, "lease.expiredId", { max: 128 }))
    for (const lease of operation.leases) {
      if (!plainObject(lease)) throw new Error("lease entry must be an object")
      const id = requireString(lease.id, "lease.id", { max: 128 })
      const command = state.commands.get(id)
      if (!command) throw new Error(`lease references missing command ${id}`)
      command.leaseUntil = requireInteger(lease.leaseUntil, "lease.leaseUntil")
      command.attempts = requireInteger(lease.attempts, "lease.attempts", { min: 1 })
    }
    return
  }
  if (operation.type === "result") {
    const { seenKey, fingerprint, source, sequence, commandId, entry } = operation
    state.seen.set(requireString(seenKey, "result.seenKey", { max: 512 }),
      requireString(fingerprint, "result.fingerprint", { max: MAX_FINGERPRINT_CHARACTERS }))
    state.lastSequence.set(requireString(source, "result.source", { max: 255 }),
      requireInteger(sequence, "result.sequence"))
    trimMap(state.seen, requireInteger(operation.seenLimit, "result.seenLimit", { min: 1 }))
    if (commandId !== null) state.commands.delete(requireString(commandId, "result.commandId", { max: 128 }))
    if (!plainObject(entry) || !plainObject(entry.message)) throw new Error("result.entry must contain a message")
    const cursor = requireInteger(entry.cursor, "result.cursor", { min: 1 })
    if (cursor !== state.cursor + 1) throw new Error("result cursor must increase by one")
    state.cursor = cursor
    state.results.push({ cursor, message: clone(entry.message) })
    const maxResults = requireInteger(operation.maxResults, "result.maxResults", { min: 1 })
    while (state.results.length > maxResults) state.results.shift()
    return
  }
  throw new Error(`unknown journal operation ${operation.type}`)
}

function journalEnvelope(revision, operation) {
  const body = { schema: SIDECAR_JOURNAL_SCHEMA, revision, operation: clone(operation) }
  return { ...body, checksum: checksum(body) }
}

function checkpointEnvelope(state) {
  const body = { schema: SIDECAR_CHECKPOINT_SCHEMA, state: serializeState(state) }
  return { ...body, checksum: checksum(body) }
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function durableWrite(path, contents) {
  const handle = await open(path, "w", 0o600)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function durableAppend(path, contents) {
  const handle = await open(path, "a", 0o600)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export class SidecarStore {
  async initialize() { throw new Error("SidecarStore.initialize is not implemented") }
  async enqueueCommand() { throw new Error("SidecarStore.enqueueCommand is not implemented") }
  async leaseCommands() { throw new Error("SidecarStore.leaseCommands is not implemented") }
  async acceptLuantiMessage() { throw new Error("SidecarStore.acceptLuantiMessage is not implemented") }
  async listResults() { throw new Error("SidecarStore.listResults is not implemented") }
  async diagnostics() { throw new Error("SidecarStore.diagnostics is not implemented") }
  async close() {}
}

class StatefulSidecarStore extends SidecarStore {
  constructor({ kind }) {
    super()
    this.kind = kind
    this._state = emptyState()
    this._initialized = false
    this._initializing = null
    this._tail = Promise.resolve()
    this._lastMaintenanceError = null
  }

  async initialize(binding) {
    const normalized = normalizeBinding(binding)
    if (!this._initializing) {
      this._initializing = (async () => {
        const loaded = await this._loadInitialState()
        if (loaded.binding === null) {
          loaded.binding = normalized
          await this._persistInitialState(loaded)
        } else if (!bindingMatches(loaded.binding, normalized)) {
          throw new Error("persistent sidecar store binding does not match the configured Luanti target and sources")
        }
        this._state = loaded
        this._initialized = true
      })()
    }
    await this._initializing
    if (!bindingMatches(this._state.binding, normalized)) {
      throw new Error("sidecar store is already initialized for a different binding")
    }
  }

  async _loadInitialState() { return emptyState() }
  async _persistInitialState() {}
  async _persistRecord() {}
  async _afterCommit() {}
  async _closeStorage() {}

  async _ready() {
    if (!this._initializing) throw new Error("sidecar store must be initialized before use")
    await this._initializing
    if (!this._initialized) throw new Error("sidecar store initialization failed")
  }

  async _exclusive(work) {
    await this._ready()
    const run = this._tail.then(work, work)
    this._tail = run.then(() => undefined, () => undefined)
    return run
  }

  async _commit(operation) {
    const revision = this._state.revision + 1
    const next = cloneState(this._state)
    applyOperation(next, operation)
    next.revision = revision
    const record = journalEnvelope(revision, operation)
    await this._persistRecord(record)
    this._state = next
    try {
      await this._afterCommit(next)
      this._lastMaintenanceError = null
    } catch (error) {
      this._lastMaintenanceError = error instanceof Error ? error.message : String(error)
    }
  }

  async enqueueCommand(message, { fingerprint, maxPendingCommands, seenLimit }) {
    return this._exclusive(async () => {
      const previousCommand = this._state.commandIds.get(message.id)
      if (previousCommand) {
        if (previousCommand.source !== message.source || previousCommand.fingerprint !== fingerprint) {
          throw new EsipError("id_conflict", "command id was already used by a different message")
        }
        return { accepted: false, duplicate: true, id: message.id }
      }
      if (this._state.commands.size >= maxPendingCommands) {
        throw new EsipError("queue_full", "pending command queue is full")
      }
      const seenKey = message.source + "\u0000" + message.id
      const previous = this._state.seen.get(seenKey)
      if (previous !== undefined) {
        if (previous !== fingerprint) throw new EsipError("id_conflict", "message id was reused with different content")
        return { accepted: false, duplicate: true, id: message.id }
      }
      const last = this._state.lastSequence.get(message.source)
      if (last !== undefined && message.sequence <= last) {
        throw new EsipError("sequence_replay", `sequence ${message.sequence} is not newer than ${last}`)
      }
      await this._commit({
        type: "enqueue",
        seenKey,
        fingerprint,
        source: message.source,
        sequence: message.sequence,
        commandId: message.id,
        commandSource: message.source,
        commandFingerprint: fingerprint,
        message: clone(message),
        seenLimit,
      })
      return { accepted: true, duplicate: false, id: message.id }
    })
  }

  async leaseCommands({ now, leaseMs, limit }) {
    return this._exclusive(async () => {
      const expiredIds = []
      const leases = []
      const messages = []
      for (const [id, entry] of this._state.commands) {
        if (Date.parse(entry.message.expiresat) <= now) {
          expiredIds.push(id)
          continue
        }
        if (entry.leaseUntil > now) continue
        leases.push({ id, leaseUntil: now + leaseMs, attempts: entry.attempts + 1 })
        messages.push(clone(entry.message))
        if (messages.length >= limit) break
      }
      if (expiredIds.length > 0 || leases.length > 0) {
        await this._commit({ type: "lease", expiredIds, leases })
      }
      return messages
    })
  }

  async acceptLuantiMessage(message, { fingerprint, commandId, maxResults, seenLimit }) {
    return this._exclusive(async () => {
      const seenKey = message.source + "\u0000" + message.id
      const previous = this._state.seen.get(seenKey)
      if (previous !== undefined) {
        if (previous !== fingerprint) throw new EsipError("id_conflict", "message id was reused with different content")
        return { accepted: false, duplicate: true, id: message.id }
      }
      const last = this._state.lastSequence.get(message.source)
      if (last !== undefined && message.sequence <= last) {
        throw new EsipError("sequence_replay", `sequence ${message.sequence} is not newer than ${last}`)
      }
      const cursor = this._state.cursor + 1
      await this._commit({
        type: "result",
        seenKey,
        fingerprint,
        source: message.source,
        sequence: message.sequence,
        commandId: commandId ?? null,
        entry: { cursor, message: clone(message) },
        maxResults,
        seenLimit,
      })
      return { accepted: true, duplicate: false, id: message.id, cursor }
    })
  }

  async listResults(after = 0, limit = 100) {
    return this._exclusive(async () => {
      const entries = this._state.results.filter((entry) => entry.cursor > after).slice(0, limit).map(clone)
      return {
        entries,
        nextCursor: entries.at(-1)?.cursor ?? after,
        latestCursor: this._state.cursor,
        oldestCursor: this._state.results[0]?.cursor ?? this._state.cursor,
      }
    })
  }

  async diagnostics(now = Date.now()) {
    return this._exclusive(async () => {
      const commands = [...this._state.commands.values()]
      const totalLeaseAttempts = commands.reduce((total, entry) => total + entry.attempts, 0)
      return {
        storage: {
          kind: this.kind,
          schema: SIDECAR_STATE_SCHEMA,
          revision: this._state.revision,
          persistent: this.kind === "journal",
          lastMaintenanceError: this._lastMaintenanceError,
          ...(await this._storageDiagnostics()),
        },
        pendingCommands: commands.length,
        leasedCommands: commands.filter((entry) => entry.leaseUntil > now).length,
        expiredCommands: commands.filter((entry) => Date.parse(entry.message.expiresat) <= now).length,
        totalLeaseAttempts,
        maxLeaseAttempts: commands.reduce((maximum, entry) => Math.max(maximum, entry.attempts), 0),
        retainedResults: this._state.results.length,
        latestCursor: this._state.cursor,
        oldestCursor: this._state.results[0]?.cursor ?? this._state.cursor,
        trackedSources: this._state.lastSequence.size,
      }
    })
  }

  async _storageDiagnostics() { return {} }

  async close() {
    if (!this._initializing) return
    await this._initializing
    await this._tail
    await this._closeStorage(this._state)
  }
}

export class MemorySidecarStore extends StatefulSidecarStore {
  constructor() {
    super({ kind: "memory" })
  }
}

export class JournalSidecarStore extends StatefulSidecarStore {
  constructor({ directory, checkpointEvery = 100 } = {}) {
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new TypeError("persistent sidecar store directory is required")
    }
    if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > 1_000_000) {
      throw new TypeError("checkpointEvery must be an integer between 1 and 1000000")
    }
    super({ kind: "journal" })
    this.directory = resolve(directory)
    this.checkpointPath = resolve(this.directory, "checkpoint.json")
    this.journalPath = resolve(this.directory, "journal.jsonl")
    this.checkpointEvery = checkpointEvery
    this.lastCheckpointRevision = 0
    this.journalBytes = 0
  }

  async _loadInitialState() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const checkpointText = await readOptional(this.checkpointPath)
    let state = emptyState()
    if (checkpointText !== null) {
      let envelope
      try { envelope = JSON.parse(checkpointText) } catch { throw new Error("persistent sidecar checkpoint is not valid JSON") }
      if (!plainObject(envelope) || envelope.schema !== SIDECAR_CHECKPOINT_SCHEMA) {
        throw new Error(`persistent sidecar checkpoint schema must be ${SIDECAR_CHECKPOINT_SCHEMA}`)
      }
      const body = { schema: envelope.schema, state: envelope.state }
      if (typeof envelope.checksum !== "string" || envelope.checksum !== checksum(body)) {
        throw new Error("persistent sidecar checkpoint checksum mismatch")
      }
      state = deserializeState(envelope.state)
      this.lastCheckpointRevision = state.revision
    }

    const journalText = await readOptional(this.journalPath)
    if (checkpointText === null && journalText !== null && journalText.trim() !== "") {
      throw new Error("persistent sidecar checkpoint is missing while journal contains data")
    }
    if (journalText !== null && journalText.trim() !== "") {
      const lines = journalText.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].trim() === "") continue
        let record
        try { record = JSON.parse(lines[index]) } catch {
          throw new Error(`persistent sidecar journal line ${index + 1} is not valid JSON`)
        }
        if (!plainObject(record) || record.schema !== SIDECAR_JOURNAL_SCHEMA) {
          throw new Error(`persistent sidecar journal line ${index + 1} has an unsupported schema`)
        }
        const body = { schema: record.schema, revision: record.revision, operation: record.operation }
        if (typeof record.checksum !== "string" || record.checksum !== checksum(body)) {
          throw new Error(`persistent sidecar journal line ${index + 1} checksum mismatch`)
        }
        const revision = requireInteger(record.revision, `journal line ${index + 1} revision`, { min: 1 })
        if (revision <= state.revision) continue
        if (revision !== state.revision + 1) {
          throw new Error(`persistent sidecar journal revision gap: expected ${state.revision + 1}, received ${revision}`)
        }
        applyOperation(state, record.operation)
        state.revision = revision
      }
    }
    try { this.journalBytes = (await stat(this.journalPath)).size } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    return state
  }

  async _persistInitialState(state) {
    await this._writeCheckpoint(state)
    await durableWrite(this.journalPath, "")
    this.journalBytes = 0
  }

  async _persistRecord(record) {
    const line = JSON.stringify(record) + "\n"
    await durableAppend(this.journalPath, line)
    this.journalBytes += Buffer.byteLength(line)
  }

  async _afterCommit(state) {
    if (state.revision - this.lastCheckpointRevision >= this.checkpointEvery) {
      await this._checkpoint(state)
    }
  }

  async _writeCheckpoint(state) {
    const temporary = resolve(this.directory, `.checkpoint-${randomUUID()}.tmp`)
    await durableWrite(temporary, JSON.stringify(checkpointEnvelope(state)) + "\n")
    await rename(temporary, this.checkpointPath)
    this.lastCheckpointRevision = state.revision
  }

  async _checkpoint(state) {
    await this._writeCheckpoint(state)
    await durableWrite(this.journalPath, "")
    this.journalBytes = 0
  }

  async _closeStorage(state) {
    if (state.revision !== this.lastCheckpointRevision || this.journalBytes > 0) {
      await this._checkpoint(state)
    }
  }

  async _storageDiagnostics() {
    return {
      checkpointRevision: this.lastCheckpointRevision,
      journalBytes: this.journalBytes,
      checkpointEvery: this.checkpointEvery,
    }
  }
}

export function createMemorySidecarStore() {
  return new MemorySidecarStore()
}

export function createJournalSidecarStore(options) {
  return new JournalSidecarStore(options)
}
