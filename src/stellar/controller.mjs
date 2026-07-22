// SPDX-License-Identifier: GPL-3.0-or-later

import { advanceStellarSystem, createStellarSystem, stellarSpecHash } from "./engine.mjs"
import { StellarError, validateStellarSpec, validateStellarState } from "./validation.mjs"

const RECORD_FIELDS = ["schemaVersion", "specId", "specHash", "revision", "control", "state"]
const CONTROL_FIELDS = ["mode", "speed"]

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireExact(value, fields, path) {
  if (!plainObject(value)) throw new StellarError("invalid_controller", `${path} must be an object`)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new StellarError("invalid_controller", `${path}.${key} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new StellarError("invalid_controller", `${path}.${field} is required`)
  }
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new StellarError("invalid_controller", `${path} must be an integer from ${min} to ${max}`)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function same(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

export function validateStellarControllerRecord(input, record) {
  const spec = validateStellarSpec(input)
  const specHash = stellarSpecHash(spec)
  requireExact(record, RECORD_FIELDS, "controller")
  if (record.schemaVersion !== 1) throw new StellarError("invalid_controller", "controller.schemaVersion must be 1")
  if (record.specId !== spec.id || record.specHash !== specHash) {
    throw new StellarError("stellar_conflict", "controller does not belong to this stellar specification")
  }
  requireInteger(record.revision, "controller.revision")
  requireExact(record.control, CONTROL_FIELDS, "controller.control")
  if (!["paused", "running"].includes(record.control.mode)) throw new StellarError("invalid_controller", "controller.control.mode is invalid")
  requireInteger(record.control.speed, "controller.control.speed", { min: 1, max: 1000 })
  const state = validateStellarState(spec, record.state, specHash)
  if (state.status !== "running" && record.control.mode !== "paused") {
    throw new StellarError("invalid_controller", "a stopped stellar system must be paused")
  }
  const replayed = runToTick(spec, state.tick)
  if (!same(replayed, state)) throw new StellarError("replay_mismatch", "controller state does not match deterministic replay")
  return structuredClone(record)
}

function runToTick(spec, tick) {
  let state = createStellarSystem(spec)
  while (state.tick < tick && state.status === "running") {
    const result = advanceStellarSystem(spec, state, Math.min(10000, tick - state.tick))
    state = result.state
  }
  if (state.tick !== tick) throw new StellarError("replay_unreachable", `stellar system stopped at tick ${state.tick}`)
  return state
}

export class StellarController {
  constructor(input, { record } = {}) {
    this._spec = validateStellarSpec(input)
    this._record = record === undefined
      ? {
          schemaVersion: 1,
          specId: this._spec.id,
          specHash: stellarSpecHash(this._spec),
          revision: 0,
          control: { mode: "paused", speed: 1 },
          state: createStellarSystem(this._spec),
        }
      : validateStellarControllerRecord(this._spec, record)
  }

  static restore(input, record) {
    return new StellarController(input, { record })
  }

  _expectRevision(expectedRevision) {
    if (expectedRevision === undefined) return
    requireInteger(expectedRevision, "expectedRevision")
    if (expectedRevision !== this._record.revision) {
      throw new StellarError("revision_conflict", `expected revision ${expectedRevision}, current revision is ${this._record.revision}`)
    }
  }

  _advance(ticks) {
    requireInteger(ticks, "ticks", { min: 1, max: this._spec.stopConditions.maxTicks })
    if (this._record.state.status !== "running") throw new StellarError("stellar_stopped", `stellar system is ${this._record.state.status}`)
    let remaining = ticks
    const events = []
    while (remaining > 0 && this._record.state.status === "running") {
      const result = advanceStellarSystem(this._spec, this._record.state, Math.min(10000, remaining))
      const advanced = result.state.tick - this._record.state.tick
      this._record.state = result.state
      events.push(...result.events)
      remaining -= advanced
      if (advanced === 0) break
    }
    if (this._record.state.status !== "running") this._record.control.mode = "paused"
    this._record.revision += 1
    return { revision: this._record.revision, state: structuredClone(this._record.state), events: structuredClone(events) }
  }

  advance(ticks, { expectedRevision } = {}) {
    this._expectRevision(expectedRevision)
    return this._advance(ticks)
  }

  pulse({ expectedRevision } = {}) {
    this._expectRevision(expectedRevision)
    if (this._record.control.mode !== "running") throw new StellarError("simulation_paused", "scheduled pulse requires running mode")
    return this._advance(this._record.control.speed)
  }

  control(action, { expectedRevision, speed } = {}) {
    this._expectRevision(expectedRevision)
    if (action === "step") {
      if (this._record.control.mode !== "paused") throw new StellarError("invalid_control", "step requires paused mode")
      return this._advance(1)
    }
    if (action === "pause") this._record.control.mode = "paused"
    else if (action === "resume") {
      if (this._record.state.status !== "running") throw new StellarError("stellar_stopped", `stellar system is ${this._record.state.status}`)
      this._record.control.mode = "running"
    }
    else if (action === "set_speed") {
      requireInteger(speed, "speed", { min: 1, max: 1000 })
      this._record.control.speed = speed
    } else throw new StellarError("invalid_control", `unknown control action ${action}`)
    this._record.revision += 1
    return { revision: this._record.revision, control: structuredClone(this._record.control) }
  }

  snapshot() {
    return {
      schemaVersion: 1,
      specId: this._record.specId,
      specHash: this._record.specHash,
      revision: this._record.revision,
      control: structuredClone(this._record.control),
      state: structuredClone(this._record.state),
    }
  }

  exportRecord() {
    return structuredClone(this._record)
  }

  get revision() {
    return this._record.revision
  }
}
