// SPDX-License-Identifier: GPL-3.0-or-later

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const BIOME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/
const UINT32_MAX = 0xffffffff
const SPEC_FIELDS = ["$schema", "schemaVersion", "id", "seed", "name", "description", "license", "origin", "values", "autonomy", "stopConditions"]
const ORIGIN_FIELDS = ["biome", "founderPopulation", "startingEra", "resources", "knowledge", "ecology", "cohesion"]
const VALUE_FIELDS = ["knowledge", "ecology", "expansion", "militarism", "collectivism"]
const AUTONOMY_FIELDS = ["mode", "strategyInterval", "allowedIntents"]
const STOP_FIELDS = ["maxTicks", "haltOnCollapse"]
const STATE_FIELDS = [
  "schemaVersion", "specId", "specHash", "name", "tick", "era", "status",
  "population", "resources", "knowledge", "ecology", "cohesion", "rngState",
  "eventCursor", "historyHash", "milestones",
]
const INTENTS = new Set(["research_focus", "resource_policy", "settlement_policy", "ecology_policy", "cohesion_policy"])
const ERAS = new Set(["origin", "settlement", "civic", "planetary"])
const STATUSES = new Set(["running", "completed", "collapsed"])
const MILESTONES = new Set(["founding", "era_settlement", "era_civic", "era_planetary"])

export class CivilizationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "CivilizationError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireObject(value, path) {
  if (!plainObject(value)) throw new CivilizationError("invalid_civilization", `${path} must be an object`)
}

function rejectUnknown(value, allowed, path) {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) throw new CivilizationError("invalid_civilization", `${path} contains unknown field ${unknown[0]}`)
}

function requireString(value, path, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new CivilizationError("invalid_civilization", `${path} must be a valid string`)
  }
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CivilizationError("invalid_civilization", `${path} must be an integer from ${min} to ${max}`)
  }
}

function requireExactKeys(value, fields, path, { optional = [] } = {}) {
  rejectUnknown(value, fields, path)
  const optionalSet = new Set(optional)
  for (const field of fields) {
    if (!optionalSet.has(field) && !(field in value)) throw new CivilizationError("invalid_civilization", `${path}.${field} is required`)
  }
}

export function validateCivilizationSpec(input) {
  requireObject(input, "spec")
  requireExactKeys(input, SPEC_FIELDS, "spec", { optional: ["$schema"] })
  if (input.$schema !== undefined) requireString(input.$schema, "spec.$schema", { max: 256 })
  if (input.schemaVersion !== 1) throw new CivilizationError("unsupported_civilization", "spec.schemaVersion must be 1")
  requireString(input.id, "spec.id", { max: 64, pattern: ID_PATTERN })
  requireString(input.seed, "spec.seed", { max: 128 })
  requireString(input.name, "spec.name", { max: 64 })
  requireString(input.description, "spec.description", { max: 512 })
  requireString(input.license, "spec.license", { max: 64 })

  requireObject(input.origin, "spec.origin")
  requireExactKeys(input.origin, ORIGIN_FIELDS, "spec.origin")
  requireString(input.origin.biome, "spec.origin.biome", { max: 64, pattern: BIOME_PATTERN })
  requireInteger(input.origin.founderPopulation, "spec.origin.founderPopulation", { min: 10, max: 1000000 })
  if (input.origin.startingEra !== "origin") throw new CivilizationError("invalid_civilization", "spec.origin.startingEra must be origin")
  for (const key of ["resources", "knowledge"]) requireInteger(input.origin[key], `spec.origin.${key}`, { max: 1000000000 })
  for (const key of ["ecology", "cohesion"]) requireInteger(input.origin[key], `spec.origin.${key}`, { max: 100 })

  requireObject(input.values, "spec.values")
  requireExactKeys(input.values, VALUE_FIELDS, "spec.values")
  for (const key of VALUE_FIELDS) requireInteger(input.values[key], `spec.values.${key}`, { max: 100 })

  requireObject(input.autonomy, "spec.autonomy")
  requireExactKeys(input.autonomy, AUTONOMY_FIELDS, "spec.autonomy")
  if (!new Set(["manual", "assisted", "autonomous"]).has(input.autonomy.mode)) {
    throw new CivilizationError("invalid_civilization", "spec.autonomy.mode is invalid")
  }
  requireInteger(input.autonomy.strategyInterval, "spec.autonomy.strategyInterval", { min: 1, max: 10000 })
  if (!Array.isArray(input.autonomy.allowedIntents) || input.autonomy.allowedIntents.length > 8) {
    throw new CivilizationError("invalid_civilization", "spec.autonomy.allowedIntents must be an array of at most 8 intents")
  }
  const intents = new Set()
  for (const intent of input.autonomy.allowedIntents) {
    if (!INTENTS.has(intent) || intents.has(intent)) throw new CivilizationError("invalid_civilization", "spec.autonomy.allowedIntents contains an invalid or duplicate intent")
    intents.add(intent)
  }

  requireObject(input.stopConditions, "spec.stopConditions")
  requireExactKeys(input.stopConditions, STOP_FIELDS, "spec.stopConditions")
  requireInteger(input.stopConditions.maxTicks, "spec.stopConditions.maxTicks", { min: 1, max: 1000000 })
  if (typeof input.stopConditions.haltOnCollapse !== "boolean") {
    throw new CivilizationError("invalid_civilization", "spec.stopConditions.haltOnCollapse must be boolean")
  }
  if (input.autonomy.strategyInterval > input.stopConditions.maxTicks) {
    throw new CivilizationError("invalid_civilization", "strategyInterval cannot exceed maxTicks")
  }
  return structuredClone(input)
}

export function validateCivilizationState(spec, state, expectedSpecHash) {
  requireObject(state, "state")
  requireExactKeys(state, STATE_FIELDS, "state")
  if (state.schemaVersion !== 1) throw new CivilizationError("unsupported_civilization", "state.schemaVersion must be 1")
  if (state.specId !== spec.id || state.name !== spec.name || state.specHash !== expectedSpecHash) {
    throw new CivilizationError("civilization_conflict", "state does not belong to this civilization specification")
  }
  if (!HASH_PATTERN.test(state.specHash) || !HASH_PATTERN.test(state.historyHash)) {
    throw new CivilizationError("invalid_civilization", "state hashes must be lowercase 8-digit hexadecimal values")
  }
  requireInteger(state.tick, "state.tick", { max: spec.stopConditions.maxTicks })
  if (!ERAS.has(state.era)) throw new CivilizationError("invalid_civilization", "state.era is invalid")
  if (!STATUSES.has(state.status)) throw new CivilizationError("invalid_civilization", "state.status is invalid")
  requireInteger(state.population, "state.population", { max: 1000000000 })
  requireInteger(state.resources, "state.resources", { max: 1000000000 })
  requireInteger(state.knowledge, "state.knowledge", { max: 1000000000 })
  requireInteger(state.ecology, "state.ecology", { max: 100 })
  requireInteger(state.cohesion, "state.cohesion", { max: 100 })
  requireInteger(state.rngState, "state.rngState", { min: 1, max: UINT32_MAX })
  requireInteger(state.eventCursor, "state.eventCursor", { max: 1000000000 })
  if (!Array.isArray(state.milestones) || state.milestones.length < 1 || state.milestones.length > 16) {
    throw new CivilizationError("invalid_civilization", "state.milestones must contain 1-16 entries")
  }
  const seen = new Set()
  let previousTick = -1
  for (const [index, milestone] of state.milestones.entries()) {
    requireObject(milestone, `state.milestones[${index}]`)
    requireExactKeys(milestone, ["id", "tick"], `state.milestones[${index}]`)
    if (!MILESTONES.has(milestone.id) || seen.has(milestone.id)) {
      throw new CivilizationError("invalid_civilization", "state milestones contain an invalid or duplicate id")
    }
    requireInteger(milestone.tick, `state.milestones[${index}].tick`, { max: state.tick })
    if (milestone.tick < previousTick) throw new CivilizationError("invalid_civilization", "state milestones must be ordered by tick")
    previousTick = milestone.tick
    seen.add(milestone.id)
  }
  if (state.status === "completed" && state.tick !== spec.stopConditions.maxTicks) {
    throw new CivilizationError("invalid_civilization", "completed civilization must be at maxTicks")
  }
  if (state.status === "running" && state.tick >= spec.stopConditions.maxTicks) {
    throw new CivilizationError("invalid_civilization", "running civilization cannot be at maxTicks")
  }
  return structuredClone(state)
}
