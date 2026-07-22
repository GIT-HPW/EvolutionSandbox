// SPDX-License-Identifier: GPL-3.0-or-later

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/
const UINT32_MAX = 0xffffffff
const SPEC_FIELDS = ["$schema", "schemaVersion", "id", "seed", "name", "description", "license", "source", "origin", "physics", "stopConditions"]
const SOURCE_FIELDS = ["repository", "chapter", "adaptation"]
const ORIGIN_FIELDS = ["nebulaMass", "stellarMass", "temperature", "density", "angularMomentum", "elementDiversity"]
const PHYSICS_FIELDS = ["accretionRate", "contractionRate", "ignitionMass", "ignitionTemperature", "fusionBurnRate", "supernovaMassThreshold", "diskRetention"]
const STOP_FIELDS = ["maxTicks", "haltOnFailure"]
const STATE_FIELDS = [
  "schemaVersion", "specId", "specHash", "name", "tick", "phase", "phaseStartedTick", "status",
  "nebulaMass", "stellarMass", "corePressure", "temperature", "angularMomentum", "luminosity",
  "stability", "fuel", "elementDiversity", "expelledMatter", "diskMass", "diskStability",
  "rngState", "eventCursor", "historyHash", "milestones",
]
const PHASES = new Set(["nebula", "protostar", "main_sequence", "red_giant", "supernova", "planetary_disk"])
const STATUSES = new Set(["running", "completed", "collapsed"])
const MILESTONES = new Set(["nebula_formed", "protostar_formed", "star_ignited", "main_sequence_completed", "supernova", "planetary_disk"])

export class StellarError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "StellarError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireObject(value, path) {
  if (!plainObject(value)) throw new StellarError("invalid_stellar", `${path} must be an object`)
}

function requireExactKeys(value, fields, path, { optional = [] } = {}) {
  requireObject(value, path)
  const allowed = new Set(fields)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new StellarError("invalid_stellar", `${path}.${key} is not allowed`)
  }
  const optionalSet = new Set(optional)
  for (const field of fields) {
    if (!optionalSet.has(field) && !(field in value)) throw new StellarError("invalid_stellar", `${path}.${field} is required`)
  }
}

function requireString(value, path, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new StellarError("invalid_stellar", `${path} must be a valid string`)
  }
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new StellarError("invalid_stellar", `${path} must be an integer from ${min} to ${max}`)
  }
}

export function validateStellarSpec(input) {
  requireExactKeys(input, SPEC_FIELDS, "spec", { optional: ["$schema"] })
  if (input.$schema !== undefined) requireString(input.$schema, "spec.$schema", { max: 256 })
  if (input.schemaVersion !== 1) throw new StellarError("unsupported_stellar", "spec.schemaVersion must be 1")
  requireString(input.id, "spec.id", { max: 64, pattern: ID_PATTERN })
  requireString(input.seed, "spec.seed", { max: 128 })
  requireString(input.name, "spec.name", { max: 64 })
  requireString(input.description, "spec.description", { max: 512 })
  requireString(input.license, "spec.license", { max: 64 })

  requireExactKeys(input.source, SOURCE_FIELDS, "spec.source")
  requireString(input.source.repository, "spec.source.repository", { max: 256 })
  if (input.source.chapter !== "第1章 第5篇 星辰：物质的熔炉") {
    throw new StellarError("invalid_stellar", "spec.source.chapter must identify Evolution chapter 1 part 5")
  }
  requireString(input.source.adaptation, "spec.source.adaptation", { max: 512 })

  requireExactKeys(input.origin, ORIGIN_FIELDS, "spec.origin")
  requireInteger(input.origin.nebulaMass, "spec.origin.nebulaMass", { min: 100, max: 1000000000 })
  requireInteger(input.origin.stellarMass, "spec.origin.stellarMass", { min: 1, max: 1000000000 })
  for (const key of ["temperature", "density"]) requireInteger(input.origin[key], `spec.origin.${key}`, { max: 1000 })
  requireInteger(input.origin.density, "spec.origin.density", { min: 1, max: 1000 })
  for (const key of ["angularMomentum", "elementDiversity"]) requireInteger(input.origin[key], `spec.origin.${key}`, { min: key === "elementDiversity" ? 1 : 0, max: 100 })

  requireExactKeys(input.physics, PHYSICS_FIELDS, "spec.physics")
  requireInteger(input.physics.accretionRate, "spec.physics.accretionRate", { min: 1, max: 10000 })
  requireInteger(input.physics.contractionRate, "spec.physics.contractionRate", { min: 1, max: 100 })
  requireInteger(input.physics.ignitionMass, "spec.physics.ignitionMass", { min: 10, max: 1000000000 })
  requireInteger(input.physics.ignitionTemperature, "spec.physics.ignitionTemperature", { min: 10, max: 1000 })
  requireInteger(input.physics.fusionBurnRate, "spec.physics.fusionBurnRate", { min: 1, max: 20 })
  requireInteger(input.physics.supernovaMassThreshold, "spec.physics.supernovaMassThreshold", { min: 10, max: 1000000000 })
  requireInteger(input.physics.diskRetention, "spec.physics.diskRetention", { min: 1, max: 100 })
  if (input.origin.stellarMass >= input.physics.ignitionMass) {
    throw new StellarError("invalid_stellar", "origin stellar mass must be below ignition mass")
  }
  if (input.origin.nebulaMass + input.origin.stellarMass < input.physics.ignitionMass) {
    throw new StellarError("invalid_stellar", "origin does not contain enough mass to ignite")
  }

  requireExactKeys(input.stopConditions, STOP_FIELDS, "spec.stopConditions")
  requireInteger(input.stopConditions.maxTicks, "spec.stopConditions.maxTicks", { min: 50, max: 1000000 })
  if (typeof input.stopConditions.haltOnFailure !== "boolean") {
    throw new StellarError("invalid_stellar", "spec.stopConditions.haltOnFailure must be boolean")
  }
  return structuredClone(input)
}

export function validateStellarState(spec, state, expectedSpecHash) {
  requireExactKeys(state, STATE_FIELDS, "state")
  if (state.schemaVersion !== 1) throw new StellarError("unsupported_stellar", "state.schemaVersion must be 1")
  if (state.specId !== spec.id || state.specHash !== expectedSpecHash || state.name !== spec.name) {
    throw new StellarError("stellar_conflict", "state does not belong to this stellar specification")
  }
  if (!HASH_PATTERN.test(state.specHash) || !HASH_PATTERN.test(state.historyHash)) {
    throw new StellarError("invalid_stellar", "state hashes must be lowercase 8-digit hexadecimal values")
  }
  requireInteger(state.tick, "state.tick", { max: spec.stopConditions.maxTicks })
  requireInteger(state.phaseStartedTick, "state.phaseStartedTick", { max: state.tick })
  if (!PHASES.has(state.phase)) throw new StellarError("invalid_stellar", "state.phase is invalid")
  if (!STATUSES.has(state.status)) throw new StellarError("invalid_stellar", "state.status is invalid")
  for (const key of ["nebulaMass", "stellarMass", "expelledMatter", "diskMass"]) {
    requireInteger(state[key], `state.${key}`, { max: 1000000000 })
  }
  for (const key of ["corePressure", "temperature"]) requireInteger(state[key], `state.${key}`, { max: 1000 })
  for (const key of ["angularMomentum", "luminosity", "stability", "fuel", "elementDiversity", "diskStability"]) {
    requireInteger(state[key], `state.${key}`, { max: 100 })
  }
  requireInteger(state.rngState, "state.rngState", { min: 1, max: UINT32_MAX })
  requireInteger(state.eventCursor, "state.eventCursor", { max: 1000000000 })
  if (!Array.isArray(state.milestones) || state.milestones.length < 1 || state.milestones.length > 8) {
    throw new StellarError("invalid_stellar", "state.milestones must contain 1-8 entries")
  }
  const seen = new Set()
  let previousTick = -1
  for (const [index, milestone] of state.milestones.entries()) {
    requireExactKeys(milestone, ["id", "tick"], `state.milestones[${index}]`)
    if (!MILESTONES.has(milestone.id) || seen.has(milestone.id)) {
      throw new StellarError("invalid_stellar", "state milestones contain an invalid or duplicate id")
    }
    requireInteger(milestone.tick, `state.milestones[${index}].tick`, { max: state.tick })
    if (milestone.tick < previousTick) throw new StellarError("invalid_stellar", "state milestones must be ordered")
    previousTick = milestone.tick
    seen.add(milestone.id)
  }
  if (state.status === "running" && state.tick >= spec.stopConditions.maxTicks) {
    throw new StellarError("invalid_stellar", "running stellar simulation cannot be at maxTicks")
  }
  return structuredClone(state)
}
