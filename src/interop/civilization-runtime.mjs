// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { CivilizationController } from "../civilization/controller.mjs"
import { validateCivilizationSpec } from "../civilization/validation.mjs"

export const CIVILIZATION_RUNTIME_STATE_SCHEMA = "evolution-civilization-runtime-state/v1"
export const CIVILIZATION_RUNTIME_CHECKPOINT_SCHEMA = "evolution-civilization-runtime-checkpoint/v1"
const STATE_FIELDS = ["schema", "revision", "hostId", "authority", "pulseLease", "completedPulses"]
const AUTHORITY_FIELDS = ["universeId", "spec", "controllerRecord"]
const LEASE_FIELDS = ["pulseId", "token", "baseRevision", "acquiredAt", "leaseUntil", "attempts"]
const COMPLETED_FIELDS = [
  "pulseId", "baseRevision", "committedRevision", "tick", "historyHash", "completedAt", "attempts",
]
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/
const MAX_COMPLETED_PULSES = 256

export class CivilizationRuntimeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "CivilizationRuntimeError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function clone(value) {
  return structuredClone(value)
}

function requireExact(value, fields, path) {
  if (!plainObject(value)) throw new CivilizationRuntimeError("invalid_runtime", `${path} must be an object`)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new CivilizationRuntimeError("invalid_runtime", `${path}.${key} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new CivilizationRuntimeError("invalid_runtime", `${path}.${field} is required`)
  }
}

function requireString(value, path, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new CivilizationRuntimeError("invalid_runtime", `${path} must be a valid string`)
  }
  return value
}

function requireId(value, path) {
  return requireString(value, path, { pattern: ID_PATTERN })
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CivilizationRuntimeError("invalid_runtime", `${path} must be an integer from ${min} to ${max}`)
  }
  return value
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

function emptyState(hostId) {
  return {
    schema: CIVILIZATION_RUNTIME_STATE_SCHEMA,
    revision: 0,
    hostId,
    authority: null,
    pulseLease: null,
    completedPulses: [],
  }
}

function validateCompletedPulse(input, path) {
  requireExact(input, COMPLETED_FIELDS, path)
  requireId(input.pulseId, `${path}.pulseId`)
  requireInteger(input.baseRevision, `${path}.baseRevision`)
  requireInteger(input.committedRevision, `${path}.committedRevision`, { min: input.baseRevision + 1 })
  requireInteger(input.tick, `${path}.tick`)
  requireString(input.historyHash, `${path}.historyHash`, { min: 8, max: 8, pattern: HASH_PATTERN })
  requireInteger(input.completedAt, `${path}.completedAt`)
  requireInteger(input.attempts, `${path}.attempts`, { min: 1 })
  return clone(input)
}

function validateRuntimeState(input) {
  requireExact(input, STATE_FIELDS, "runtime")
  if (input.schema !== CIVILIZATION_RUNTIME_STATE_SCHEMA) {
    throw new CivilizationRuntimeError("unsupported_runtime", `runtime.schema must be ${CIVILIZATION_RUNTIME_STATE_SCHEMA}`)
  }
  requireInteger(input.revision, "runtime.revision")
  requireId(input.hostId, "runtime.hostId")
  let authority = null
  if (input.authority !== null) {
    requireExact(input.authority, AUTHORITY_FIELDS, "runtime.authority")
    requireId(input.authority.universeId, "runtime.authority.universeId")
    if (!plainObject(input.authority.spec) || !plainObject(input.authority.controllerRecord)) {
      throw new CivilizationRuntimeError("invalid_runtime", "runtime authority must contain a spec and controller record")
    }
    authority = clone(input.authority)
  }
  let pulseLease = null
  if (input.pulseLease !== null) {
    if (authority === null) throw new CivilizationRuntimeError("invalid_runtime", "pulse lease requires an authority")
    requireExact(input.pulseLease, LEASE_FIELDS, "runtime.pulseLease")
    requireId(input.pulseLease.pulseId, "runtime.pulseLease.pulseId")
    requireString(input.pulseLease.token, "runtime.pulseLease.token", { max: 128 })
    requireInteger(input.pulseLease.baseRevision, "runtime.pulseLease.baseRevision")
    requireInteger(input.pulseLease.acquiredAt, "runtime.pulseLease.acquiredAt")
    requireInteger(input.pulseLease.leaseUntil, "runtime.pulseLease.leaseUntil", { min: input.pulseLease.acquiredAt + 1 })
    requireInteger(input.pulseLease.attempts, "runtime.pulseLease.attempts", { min: 1 })
    if (input.pulseLease.baseRevision !== authority.controllerRecord.revision) {
      throw new CivilizationRuntimeError("invalid_runtime", "pulse lease base revision must match the controller")
    }
    pulseLease = clone(input.pulseLease)
  }
  if (!Array.isArray(input.completedPulses) || input.completedPulses.length > MAX_COMPLETED_PULSES) {
    throw new CivilizationRuntimeError("invalid_runtime", `runtime.completedPulses must contain at most ${MAX_COMPLETED_PULSES} entries`)
  }
  const ids = new Set()
  const completedPulses = input.completedPulses.map((entry, index) => {
    const completed = validateCompletedPulse(entry, `runtime.completedPulses[${index}]`)
    if (ids.has(completed.pulseId)) {
      throw new CivilizationRuntimeError("invalid_runtime", "completed pulse ids must be unique")
    }
    ids.add(completed.pulseId)
    return completed
  })
  if (pulseLease !== null && ids.has(pulseLease.pulseId)) {
    throw new CivilizationRuntimeError("invalid_runtime", "a completed pulse cannot retain a lease")
  }
  return {
    schema: input.schema,
    revision: input.revision,
    hostId: input.hostId,
    authority,
    pulseLease,
    completedPulses,
  }
}

function checkpointEnvelope(state) {
  const body = { schema: CIVILIZATION_RUNTIME_CHECKPOINT_SCHEMA, state: clone(state) }
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

export class CivilizationRuntimeStore {
  async initialize() { throw new Error("CivilizationRuntimeStore.initialize is not implemented") }
  async read() { throw new Error("CivilizationRuntimeStore.read is not implemented") }
  async createAuthority() { throw new Error("CivilizationRuntimeStore.createAuthority is not implemented") }
  async updateController() { throw new Error("CivilizationRuntimeStore.updateController is not implemented") }
  async acquirePulse() { throw new Error("CivilizationRuntimeStore.acquirePulse is not implemented") }
  async completePulse() { throw new Error("CivilizationRuntimeStore.completePulse is not implemented") }
  async releasePulse() { throw new Error("CivilizationRuntimeStore.releasePulse is not implemented") }
  async diagnostics() { throw new Error("CivilizationRuntimeStore.diagnostics is not implemented") }
  async close() {}
}

class StatefulCivilizationRuntimeStore extends CivilizationRuntimeStore {
  constructor({ kind }) {
    super()
    this.kind = kind
    this._state = null
    this._initializing = null
    this._tail = Promise.resolve()
  }

  async initialize(hostId) {
    requireId(hostId, "hostId")
    if (!this._initializing) {
      this._initializing = (async () => {
        const loaded = await this._loadState()
        if (loaded === null) {
          const initial = emptyState(hostId)
          await this._persistState(initial)
          this._state = initial
        } else {
          const state = validateRuntimeState(loaded)
          if (state.hostId !== hostId) {
            throw new CivilizationRuntimeError(
              "runtime_binding_mismatch",
              `persistent civilization runtime belongs to host ${state.hostId}`,
            )
          }
          this._state = state
        }
      })()
    }
    await this._initializing
    if (this._state.hostId !== hostId) {
      throw new CivilizationRuntimeError("runtime_binding_mismatch", "runtime store is already bound to another host")
    }
  }

  async _loadState() { return null }
  async _persistState() {}
  async _storageDiagnostics() { return {} }

  async _ready() {
    if (!this._initializing) throw new CivilizationRuntimeError("runtime_not_initialized", "runtime store must be initialized")
    await this._initializing
  }

  async _exclusive(work) {
    await this._ready()
    const run = this._tail.then(work, work)
    this._tail = run.then(() => undefined, () => undefined)
    return run
  }

  async _commit(change) {
    const next = validateRuntimeState(change(clone(this._state)))
    next.revision = this._state.revision + 1
    await this._persistState(next)
    this._state = next
    return clone(next)
  }

  async read() {
    return this._exclusive(async () => clone(this._state))
  }

  async createAuthority({ universeId, spec, controllerRecord }) {
    return this._exclusive(async () => {
      if (this._state.authority !== null) {
        throw new CivilizationRuntimeError("civilization_exists", "runtime already hosts a civilization")
      }
      requireId(universeId, "universeId")
      const checkedSpec = validateCivilizationSpec(spec)
      const checkedRecord = CivilizationController.restore(checkedSpec, controllerRecord).exportRecord()
      return this._commit((next) => {
        next.authority = { universeId, spec: checkedSpec, controllerRecord: checkedRecord }
        return next
      })
    })
  }

  async updateController({ expectedRevision, controllerRecord, now }) {
    return this._exclusive(async () => {
      if (this._state.authority === null) {
        throw new CivilizationRuntimeError("civilization_not_created", "runtime has no civilization")
      }
      requireInteger(expectedRevision, "expectedRevision")
      requireInteger(now, "now")
      if (this._state.authority.controllerRecord.revision !== expectedRevision) {
        throw new CivilizationRuntimeError("revision_conflict", "persisted controller revision changed")
      }
      if (this._state.pulseLease !== null && this._state.pulseLease.leaseUntil > now) {
        throw new CivilizationRuntimeError("pulse_in_flight", "controller cannot change while a pulse lease is active")
      }
      if (!plainObject(controllerRecord) || controllerRecord.revision !== expectedRevision + 1) {
        throw new CivilizationRuntimeError("invalid_runtime", "controller update must increase revision by one")
      }
      const checkedRecord = CivilizationController.restore(
        this._state.authority.spec,
        controllerRecord,
      ).exportRecord()
      return this._commit((next) => {
        next.authority.controllerRecord = checkedRecord
        next.pulseLease = null
        return next
      })
    })
  }

  async acquirePulse({ pulseId, now, leaseMs, token }) {
    return this._exclusive(async () => {
      requireId(pulseId, "pulseId")
      requireInteger(now, "now")
      requireInteger(leaseMs, "leaseMs", { min: 100, max: 300000 })
      requireString(token, "token", { max: 128 })
      if (this._state.authority === null) {
        throw new CivilizationRuntimeError("civilization_not_created", "runtime has no civilization")
      }
      const completed = this._state.completedPulses.find((entry) => entry.pulseId === pulseId)
      if (completed) return { status: "duplicate", completed: clone(completed), state: clone(this._state) }
      const existing = this._state.pulseLease
      if (existing !== null && existing.leaseUntil > now) {
        return { status: "in_flight", lease: clone(existing), state: clone(this._state) }
      }
      const attempts = existing?.pulseId === pulseId ? existing.attempts + 1 : 1
      const baseRevision = this._state.authority.controllerRecord.revision
      const state = await this._commit((next) => {
        next.pulseLease = { pulseId, token, baseRevision, acquiredAt: now, leaseUntil: now + leaseMs, attempts }
        return next
      })
      return { status: "acquired", lease: clone(state.pulseLease), state }
    })
  }

  async completePulse({ pulseId, token, controllerRecord, completedAt }) {
    return this._exclusive(async () => {
      requireId(pulseId, "pulseId")
      requireString(token, "token", { max: 128 })
      requireInteger(completedAt, "completedAt")
      const completed = this._state.completedPulses.find((entry) => entry.pulseId === pulseId)
      if (completed) return { status: "duplicate", completed: clone(completed), state: clone(this._state) }
      const lease = this._state.pulseLease
      if (lease === null || lease.pulseId !== pulseId || lease.token !== token) {
        throw new CivilizationRuntimeError("pulse_lease_mismatch", "pulse completion does not own the active lease")
      }
      if (lease.leaseUntil <= completedAt) {
        throw new CivilizationRuntimeError("pulse_lease_expired", "pulse lease expired before completion")
      }
      if (this._state.authority.controllerRecord.revision !== lease.baseRevision
        || !plainObject(controllerRecord)
        || controllerRecord.revision !== lease.baseRevision + 1) {
        throw new CivilizationRuntimeError("revision_conflict", "pulse result does not follow its leased controller revision")
      }
      const checkedRecord = CivilizationController.restore(
        this._state.authority.spec,
        controllerRecord,
      ).exportRecord()
      const timeline = checkedRecord.timelines.find((entry) => entry.timelineId === checkedRecord.activeTimelineId)
      if (!plainObject(timeline?.state)) {
        throw new CivilizationRuntimeError("invalid_runtime", "pulse result has no active timeline state")
      }
      const entry = validateCompletedPulse({
        pulseId,
        baseRevision: lease.baseRevision,
        committedRevision: checkedRecord.revision,
        tick: timeline.state.tick,
        historyHash: timeline.state.historyHash,
        completedAt,
        attempts: lease.attempts,
      }, "completedPulse")
      const state = await this._commit((next) => {
        next.authority.controllerRecord = checkedRecord
        next.pulseLease = null
        next.completedPulses.push(entry)
        while (next.completedPulses.length > MAX_COMPLETED_PULSES) next.completedPulses.shift()
        return next
      })
      return { status: "committed", completed: clone(entry), state }
    })
  }

  async releasePulse({ pulseId, token }) {
    return this._exclusive(async () => {
      requireId(pulseId, "pulseId")
      requireString(token, "token", { max: 128 })
      const lease = this._state.pulseLease
      if (lease === null) return clone(this._state)
      if (lease.pulseId !== pulseId || lease.token !== token) {
        throw new CivilizationRuntimeError("pulse_lease_mismatch", "cannot release a pulse lease owned by another worker")
      }
      return this._commit((next) => {
        next.pulseLease = null
        return next
      })
    })
  }

  async diagnostics(now = Date.now()) {
    return this._exclusive(async () => ({
      storage: {
        kind: this.kind,
        schema: CIVILIZATION_RUNTIME_STATE_SCHEMA,
        revision: this._state.revision,
        persistent: this.kind === "checkpoint",
        ...(await this._storageDiagnostics()),
      },
      hostId: this._state.hostId,
      hasAuthority: this._state.authority !== null,
      universeId: this._state.authority?.universeId ?? null,
      controllerRevision: this._state.authority?.controllerRecord.revision ?? null,
      pulseLease: this._state.pulseLease === null ? null : {
        pulseId: this._state.pulseLease.pulseId,
        baseRevision: this._state.pulseLease.baseRevision,
        leaseUntil: this._state.pulseLease.leaseUntil,
        expired: this._state.pulseLease.leaseUntil <= now,
        attempts: this._state.pulseLease.attempts,
      },
      retainedCompletedPulses: this._state.completedPulses.length,
    }))
  }

  async close() {
    if (!this._initializing) return
    await this._initializing
    await this._tail
  }
}

export class MemoryCivilizationRuntimeStore extends StatefulCivilizationRuntimeStore {
  constructor() {
    super({ kind: "memory" })
  }
}

export class CheckpointCivilizationRuntimeStore extends StatefulCivilizationRuntimeStore {
  constructor({ directory } = {}) {
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new TypeError("civilization runtime directory is required")
    }
    super({ kind: "checkpoint" })
    this.directory = resolve(directory)
    this.checkpointPath = resolve(this.directory, "civilization-runtime.json")
  }

  async _loadState() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const text = await readOptional(this.checkpointPath)
    if (text === null) return null
    let envelope
    try { envelope = JSON.parse(text) } catch {
      throw new CivilizationRuntimeError("invalid_runtime", "civilization runtime checkpoint is not valid JSON")
    }
    if (!plainObject(envelope) || envelope.schema !== CIVILIZATION_RUNTIME_CHECKPOINT_SCHEMA) {
      throw new CivilizationRuntimeError(
        "unsupported_runtime",
        `civilization runtime checkpoint schema must be ${CIVILIZATION_RUNTIME_CHECKPOINT_SCHEMA}`,
      )
    }
    const body = { schema: envelope.schema, state: envelope.state }
    if (typeof envelope.checksum !== "string" || envelope.checksum !== checksum(body)) {
      throw new CivilizationRuntimeError("runtime_checksum_mismatch", "civilization runtime checkpoint checksum mismatch")
    }
    return envelope.state
  }

  async _persistState(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const temporary = resolve(this.directory, `.civilization-runtime-${randomUUID()}.tmp`)
    await durableWrite(temporary, JSON.stringify(checkpointEnvelope(state)) + "\n")
    await rename(temporary, this.checkpointPath)
  }

  async _storageDiagnostics() {
    let bytes = 0
    try { bytes = (await stat(this.checkpointPath)).size } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
    return { checkpointPath: this.checkpointPath, checkpointBytes: bytes }
  }
}

export class CivilizationSidecarRuntime {
  constructor({
    store = new MemoryCivilizationRuntimeStore(),
    hostId = "civilization-engine-alpha",
    leaseMs = 5000,
    now = () => Date.now(),
    token = () => randomUUID(),
  } = {}) {
    if (!(store instanceof CivilizationRuntimeStore)) throw new TypeError("store must implement CivilizationRuntimeStore")
    requireId(hostId, "hostId")
    requireInteger(leaseMs, "leaseMs", { min: 100, max: 300000 })
    if (typeof now !== "function" || typeof token !== "function") throw new TypeError("now and token must be functions")
    this.store = store
    this.hostId = hostId
    this.leaseMs = leaseMs
    this.now = now
    this.token = token
    this._initializing = null
    this._tail = Promise.resolve()
    this._spec = undefined
    this._controller = undefined
    this._universeId = undefined
  }

  async initialize() {
    if (!this._initializing) {
      this._initializing = (async () => {
        await this.store.initialize(this.hostId)
        this._restore(await this.store.read())
      })()
    }
    await this._initializing
    return this
  }

  _restore(state) {
    if (state.authority === null) {
      this._spec = undefined
      this._controller = undefined
      this._universeId = undefined
      return
    }
    const spec = validateCivilizationSpec(state.authority.spec)
    const controller = CivilizationController.restore(spec, state.authority.controllerRecord)
    this._spec = spec
    this._controller = controller
    this._universeId = state.authority.universeId
  }

  async _exclusive(work) {
    await this.initialize()
    const run = this._tail.then(work, work)
    this._tail = run.then(() => undefined, () => undefined)
    return run
  }

  async create({ spec, universeId, timelineId = "origin", snapshotInterval = 100 }) {
    return this._exclusive(async () => {
      if (this._controller) throw new CivilizationRuntimeError("civilization_exists", "runtime already hosts a civilization")
      const checkedSpec = validateCivilizationSpec(spec)
      const candidate = new CivilizationController(checkedSpec, { timelineId, snapshotInterval })
      const state = await this.store.createAuthority({
        universeId,
        spec: checkedSpec,
        controllerRecord: candidate.exportRecord(),
      })
      this._restore(state)
      return { record: this.controllerRecord, snapshot: this.controllerSnapshot }
    })
  }

  async execute(action, options = {}) {
    return this._exclusive(async () => {
      const current = await this.store.read()
      this._restore(current)
      if (!this._controller) throw new CivilizationRuntimeError("civilization_not_created", "runtime has no civilization")
      const baseRevision = this._controller.revision
      const candidate = CivilizationController.restore(this._spec, this._controller.exportRecord())
      let result
      if (action === "advance") result = candidate.advance(options.ticks, { expectedRevision: options.expectedRevision })
      else if (["pause", "resume", "step", "set_speed"].includes(action)) {
        result = candidate.control(action, { expectedRevision: options.expectedRevision, speed: options.speed })
      } else if (action === "branch") {
        result = candidate.branch(options.newTimelineId, {
          expectedRevision: options.expectedRevision,
          fromTimelineId: options.fromTimelineId,
          atTick: options.atTick,
        })
      } else if (action === "switch_timeline") {
        result = candidate.switchTimeline(options.targetTimelineId, { expectedRevision: options.expectedRevision })
      } else if (action === "commit_experiment") {
        result = candidate.applyExperiment(options.proposal, { expectedRevision: options.expectedRevision })
      } else {
        throw new CivilizationRuntimeError("invalid_control", `unsupported civilization runtime action ${action}`)
      }
      const state = await this.store.updateController({
        expectedRevision: baseRevision,
        controllerRecord: candidate.exportRecord(),
        now: this.now(),
      })
      this._restore(state)
      return { result, record: this.controllerRecord, snapshot: this.controllerSnapshot }
    })
  }

  async pulse(pulseId, { now = this.now() } = {}) {
    return this._exclusive(async () => {
      requireId(pulseId, "pulseId")
      requireInteger(now, "now")
      const current = await this.store.read()
      this._restore(current)
      if (!this._controller) throw new CivilizationRuntimeError("civilization_not_created", "runtime has no civilization")
      const acquired = await this.store.acquirePulse({
        pulseId,
        now,
        leaseMs: this.leaseMs,
        token: this.token(),
      })
      if (acquired.status !== "acquired") {
        this._restore(acquired.state)
        return {
          status: acquired.status,
          duplicate: acquired.status === "duplicate",
          completed: acquired.completed,
          lease: acquired.lease,
          snapshot: this.controllerSnapshot,
        }
      }
      const candidate = CivilizationController.restore(
        acquired.state.authority.spec,
        acquired.state.authority.controllerRecord,
      )
      let result
      try {
        result = candidate.pulse({ expectedRevision: acquired.lease.baseRevision })
      } catch (error) {
        await this.store.releasePulse({ pulseId, token: acquired.lease.token })
        throw error
      }
      const committed = await this.store.completePulse({
        pulseId,
        token: acquired.lease.token,
        controllerRecord: candidate.exportRecord(),
        completedAt: now,
      })
      this._restore(committed.state)
      return {
        status: committed.status,
        duplicate: committed.status === "duplicate",
        completed: committed.completed,
        result,
        snapshot: this.controllerSnapshot,
      }
    })
  }

  async diagnostics(now = this.now()) {
    await this.initialize()
    return this.store.diagnostics(now)
  }

  async close() {
    await this.initialize()
    await this._tail
    await this.store.close()
  }

  snapshot(options = {}) {
    return this._controller?.snapshot(options)
  }

  get controllerSnapshot() {
    return this.snapshot()
  }

  get controllerRecord() {
    return this._controller?.exportRecord()
  }

  get revision() {
    return this._controller?.revision
  }

  get universeId() {
    return this._universeId
  }

  get civilizationSpec() {
    return this._spec === undefined ? undefined : clone(this._spec)
  }
}

export class CivilizationPulseScheduler {
  constructor({ runtime, intervalMs = 1000, epochMs = 0, now = () => Date.now() } = {}) {
    if (!(runtime instanceof CivilizationSidecarRuntime)) {
      throw new TypeError("runtime must be a CivilizationSidecarRuntime")
    }
    requireInteger(intervalMs, "intervalMs", { min: 100, max: 86400000 })
    requireInteger(epochMs, "epochMs")
    if (typeof now !== "function") throw new TypeError("now must be a function")
    this.runtime = runtime
    this.intervalMs = intervalMs
    this.epochMs = epochMs
    this.now = now
  }

  pulseIdAt(now) {
    requireInteger(now, "now")
    if (now < this.epochMs) return null
    return `scheduled-pulse:${Math.floor((now - this.epochMs) / this.intervalMs)}`
  }

  async runDue(now = this.now()) {
    const pulseId = this.pulseIdAt(now)
    if (pulseId === null) return { status: "not_due", duplicate: false, pulseId: null }
    return { pulseId, ...(await this.runtime.pulse(pulseId, { now })) }
  }
}

export function createMemoryCivilizationRuntimeStore() {
  return new MemoryCivilizationRuntimeStore()
}

export function createCheckpointCivilizationRuntimeStore(options) {
  return new CheckpointCivilizationRuntimeStore(options)
}

export function createCivilizationSidecarRuntime(options) {
  return new CivilizationSidecarRuntime(options)
}

export function createCivilizationPulseScheduler(options) {
  return new CivilizationPulseScheduler(options)
}
