// SPDX-License-Identifier: GPL-3.0-or-later

export const WORLD_OBSERVATION_SCHEMA_VERSION = 1

const OBSERVATION_FIELDS = [
  "schemaVersion", "universeId", "timelineId", "domain", "tick", "timeScale",
  "revision", "phase", "rulePackVersion", "summary", "recentEvents",
  "capabilities", "provenance",
]
const SUMMARY_FIELDS = ["title", "status", "metrics"]
const METRIC_FIELDS = ["id", "label", "value", "unit"]
const EVENT_FIELDS = ["id", "type", "tick", "summary"]
const PROVENANCE_FIELDS = ["authority", "source", "adapter", "sourceVersion"]
const DOMAINS = new Set(["origin", "stellar", "civilization"])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const CAPABILITY_PATTERN = /^[a-z][a-z0-9._:-]{0,63}$/

export class WorldObservationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "WorldObservationError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireExact(value, fields, path) {
  if (!plainObject(value)) throw new WorldObservationError("invalid_observation", `${path} must be an object`)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new WorldObservationError("invalid_observation", `${path}.${key} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new WorldObservationError("invalid_observation", `${path}.${field} is required`)
  }
}

function requireString(value, path, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new WorldObservationError("invalid_observation", `${path} must be a valid string`)
  }
}

function requireId(value, path) {
  requireString(value, path, { pattern: ID_PATTERN })
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WorldObservationError("invalid_observation", `${path} must be an integer from ${min} to ${max}`)
  }
}

function validateSummary(summary) {
  requireExact(summary, SUMMARY_FIELDS, "observation.summary")
  requireString(summary.title, "observation.summary.title", { max: 128 })
  requireString(summary.status, "observation.summary.status", { max: 64 })
  if (!Array.isArray(summary.metrics) || summary.metrics.length > 64) {
    throw new WorldObservationError("invalid_observation", "observation.summary.metrics must contain at most 64 entries")
  }
  const metricIds = new Set()
  for (const [index, metric] of summary.metrics.entries()) {
    const path = `observation.summary.metrics[${index}]`
    requireExact(metric, METRIC_FIELDS, path)
    requireId(metric.id, `${path}.id`)
    if (metricIds.has(metric.id)) throw new WorldObservationError("invalid_observation", "observation metric ids must be unique")
    metricIds.add(metric.id)
    requireString(metric.label, `${path}.label`, { max: 64 })
    if (!["string", "number", "boolean"].includes(typeof metric.value) || (typeof metric.value === "number" && !Number.isFinite(metric.value))) {
      throw new WorldObservationError("invalid_observation", `${path}.value must be a finite scalar`)
    }
    requireString(metric.unit, `${path}.unit`, { min: 0, max: 32 })
  }
}

function validateEvents(events, observationTick) {
  if (!Array.isArray(events) || events.length > 64) {
    throw new WorldObservationError("invalid_observation", "observation.recentEvents must contain at most 64 entries")
  }
  const eventIds = new Set()
  let previousTick = -1
  for (const [index, event] of events.entries()) {
    const path = `observation.recentEvents[${index}]`
    requireExact(event, EVENT_FIELDS, path)
    requireId(event.id, `${path}.id`)
    if (eventIds.has(event.id)) throw new WorldObservationError("invalid_observation", "observation event ids must be unique")
    eventIds.add(event.id)
    requireString(event.type, `${path}.type`, { max: 64, pattern: CAPABILITY_PATTERN })
    requireInteger(event.tick, `${path}.tick`, { max: observationTick })
    if (event.tick < previousTick) throw new WorldObservationError("invalid_observation", "observation event ticks must be ordered")
    previousTick = event.tick
    requireString(event.summary, `${path}.summary`, { max: 256 })
  }
}

function validateCapabilities(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length > 64) {
    throw new WorldObservationError("invalid_observation", "observation.capabilities must contain at most 64 entries")
  }
  const seen = new Set()
  for (const [index, capability] of capabilities.entries()) {
    requireString(capability, `observation.capabilities[${index}]`, { max: 64, pattern: CAPABILITY_PATTERN })
    if (seen.has(capability)) throw new WorldObservationError("invalid_observation", "observation capabilities must be unique")
    seen.add(capability)
  }
}

function validateProvenance(provenance) {
  requireExact(provenance, PROVENANCE_FIELDS, "observation.provenance")
  requireId(provenance.authority, "observation.provenance.authority")
  requireId(provenance.source, "observation.provenance.source")
  requireId(provenance.adapter, "observation.provenance.adapter")
  requireString(provenance.sourceVersion, "observation.provenance.sourceVersion", { max: 64 })
}

export function validateWorldObservation(input, {
  allowedSources,
  expectedDomain,
  expectedUniverseId,
  expectedTimelineId,
} = {}) {
  requireExact(input, OBSERVATION_FIELDS, "observation")
  if (input.schemaVersion !== WORLD_OBSERVATION_SCHEMA_VERSION) {
    throw new WorldObservationError("unsupported_observation", `observation.schemaVersion must be ${WORLD_OBSERVATION_SCHEMA_VERSION}`)
  }
  requireId(input.universeId, "observation.universeId")
  requireId(input.timelineId, "observation.timelineId")
  if (!DOMAINS.has(input.domain)) throw new WorldObservationError("invalid_observation", "observation.domain is invalid")
  requireInteger(input.tick, "observation.tick")
  requireInteger(input.timeScale, "observation.timeScale", { max: 10000 })
  requireInteger(input.revision, "observation.revision")
  requireId(input.phase, "observation.phase")
  requireString(input.rulePackVersion, "observation.rulePackVersion", { max: 64 })
  validateSummary(input.summary)
  validateEvents(input.recentEvents, input.tick)
  validateCapabilities(input.capabilities)
  validateProvenance(input.provenance)

  if (expectedDomain !== undefined && input.domain !== expectedDomain) {
    throw new WorldObservationError("observation_conflict", `expected domain ${expectedDomain}, received ${input.domain}`)
  }
  if (expectedUniverseId !== undefined && input.universeId !== expectedUniverseId) {
    throw new WorldObservationError("observation_conflict", `expected universe ${expectedUniverseId}, received ${input.universeId}`)
  }
  if (expectedTimelineId !== undefined && input.timelineId !== expectedTimelineId) {
    throw new WorldObservationError("observation_conflict", `expected timeline ${expectedTimelineId}, received ${input.timelineId}`)
  }
  if (allowedSources !== undefined && !new Set(allowedSources).has(input.provenance.source)) {
    throw new WorldObservationError("unknown_provenance", `observation source ${input.provenance.source} is not allowed`)
  }
  return structuredClone(input)
}
