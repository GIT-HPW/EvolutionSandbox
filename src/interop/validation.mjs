// SPDX-License-Identifier: GPL-3.0-or-later

import { CLOUD_EVENTS_VERSION, ESIP_VERSION, KINDS, MESSAGE_DEFINITIONS, schemaUrlFor } from "./message-types.mjs"
import { EsipError } from "./errors.mjs"
import { validateCivilizationSpec } from "../civilization/validation.mjs"

const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+){2,}\.v[1-9][0-9]*$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ACTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const ENVELOPE_FIELDS = [
  "specversion", "esipversion", "id", "source", "type", "kind", "time",
  "subject", "target", "datacontenttype", "dataschema", "sequence", "tick",
  "correlationid", "causationid", "expiresat", "data",
]

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireObject(value, path) {
  if (!plainObject(value)) throw new EsipError("invalid_message", `${path} must be an object`)
}

function rejectUnknown(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new EsipError("invalid_message", `${path}.${key} is not allowed`)
  }
}

function requireJson(value, path, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EsipError("invalid_message", `${path} contains a non-finite number`)
    return
  }
  if (typeof value !== "object") throw new EsipError("invalid_message", `${path} is not JSON serializable`)
  if (seen.has(value)) throw new EsipError("invalid_message", `${path} contains a cycle`)
  seen.add(value)
  if (Array.isArray(value)) value.forEach((item, index) => requireJson(item, `${path}[${index}]`, seen))
  else {
    if (!plainObject(value)) throw new EsipError("invalid_message", `${path} contains a non-plain object`)
    for (const [key, item] of Object.entries(value)) requireJson(item, `${path}.${key}`, seen)
  }
  seen.delete(value)
}

function requireString(value, path, { min = 1, max = 256, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new EsipError("invalid_message", `${path} is invalid`)
  }
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new EsipError("invalid_message", `${path} must be an integer between ${min} and ${max}`)
  }
}

function requireId(value, path) {
  requireString(value, path, { max: 128, pattern: ID_PATTERN })
}

function requireContext(value, { actor = false, realm = false } = {}) {
  requireObject(value, "data.context")
  rejectUnknown(value, ["universeId", "timelineId", "realmId", "actorId"], "data.context")
  requireId(value.universeId, "data.context.universeId")
  requireId(value.timelineId, "data.context.timelineId")
  if (realm) requireId(value.realmId, "data.context.realmId")
  else if (value.realmId !== undefined) requireId(value.realmId, "data.context.realmId")
  if (actor) requireId(value.actorId, "data.context.actorId")
  else if (value.actorId !== undefined) requireId(value.actorId, "data.context.actorId")
}

function requireState(value, path = "data.state") {
  requireObject(value, path)
  rejectUnknown(value, ["schema", "phase", "dimension", "energy", "information", "entropy", "stability", "fragments", "matter", "matterCreated", "matterStabilized", "matterRecycled", "timeline", "steps"], path)
  for (const key of ["phase", "timeline"]) requireString(value[key], `${path}.${key}`, { max: 128 })
  for (const key of ["dimension", "energy", "information", "entropy", "stability", "fragments", "steps"]) {
    requireInteger(value[key], `${path}.${key}`)
  }
  for (const key of ["matter", "matterCreated", "matterStabilized", "matterRecycled"]) {
    if (value[key] !== undefined) requireInteger(value[key], `${path}.${key}`)
  }
}

function requireTimelineEntry(value, path) {
  requireObject(value, path)
  rejectUnknown(value, ["timelineId", "parentTimelineId", "createdByActorId", "registryRevision"], path)
  requireId(value.timelineId, `${path}.timelineId`)
  if (value.parentTimelineId !== undefined) requireId(value.parentTimelineId, `${path}.parentTimelineId`)
  requireId(value.createdByActorId, `${path}.createdByActorId`)
  requireInteger(value.registryRevision, `${path}.registryRevision`)
}

function requireTimelineEntries(value, path, { allowNull = false } = {}) {
  if (allowNull && value === null) return
  if (!Array.isArray(value) || value.length > 256) throw new EsipError("invalid_message", `${path} must be an array of at most 256 timelines`)
  value.forEach((entry, index) => requireTimelineEntry(entry, `${path}[${index}]`))
}

function requireCivilizationEvent(value, path) {
  requireObject(value, path)
  rejectUnknown(value, ["cursor", "tick", "type", "title", "effects"], path)
  requireInteger(value.cursor, `${path}.cursor`)
  requireInteger(value.tick, `${path}.tick`)
  requireString(value.type, `${path}.type`, { max: 64 })
  requireString(value.title, `${path}.title`, { max: 128 })
  requireObject(value.effects, `${path}.effects`)
}

function requireCivilizationState(value, path) {
  requireObject(value, path)
  rejectUnknown(value, [
    "schemaVersion", "specId", "specHash", "name", "tick", "era", "status",
    "population", "resources", "knowledge", "ecology", "cohesion", "rngState",
    "eventCursor", "historyHash", "milestones",
  ], path)
  if (value.schemaVersion !== 1) throw new EsipError("invalid_message", `${path}.schemaVersion must be 1`)
  requireId(value.specId, `${path}.specId`)
  requireString(value.name, `${path}.name`, { max: 64 })
  for (const key of ["specHash", "historyHash"]) {
    requireString(value[key], `${path}.${key}`, { min: 8, max: 8, pattern: /^[0-9a-f]{8}$/ })
  }
  for (const key of ["tick", "population", "resources", "knowledge", "rngState", "eventCursor"]) {
    requireInteger(value[key], `${path}.${key}`)
  }
  for (const key of ["ecology", "cohesion"]) requireInteger(value[key], `${path}.${key}`, { max: 100 })
  if (!["origin", "settlement", "civic", "planetary"].includes(value.era)) {
    throw new EsipError("invalid_message", `${path}.era is invalid`)
  }
  if (!["running", "completed", "collapsed"].includes(value.status)) {
    throw new EsipError("invalid_message", `${path}.status is invalid`)
  }
  if (!Array.isArray(value.milestones) || value.milestones.length < 1 || value.milestones.length > 16) {
    throw new EsipError("invalid_message", `${path}.milestones must contain 1-16 entries`)
  }
  value.milestones.forEach((milestone, index) => {
    const milestonePath = `${path}.milestones[${index}]`
    requireObject(milestone, milestonePath)
    rejectUnknown(milestone, ["id", "tick"], milestonePath)
    requireString(milestone.id, `${milestonePath}.id`, { max: 64 })
    requireInteger(milestone.tick, `${milestonePath}.tick`, { max: value.tick })
  })
}

function requireCivilizationSnapshot(value, path = "data.snapshot") {
  requireObject(value, path)
  rejectUnknown(value, [
    "schemaVersion", "specId", "specHash", "revision", "control", "activeTimelineId",
    "state", "timelines", "recentEvents",
  ], path)
  if (value.schemaVersion !== 1) throw new EsipError("invalid_message", `${path}.schemaVersion must be 1`)
  requireId(value.specId, `${path}.specId`)
  requireString(value.specHash, `${path}.specHash`, { min: 8, max: 8, pattern: /^[0-9a-f]{8}$/ })
  requireInteger(value.revision, `${path}.revision`)
  requireObject(value.control, `${path}.control`)
  rejectUnknown(value.control, ["mode", "speed"], `${path}.control`)
  if (!["paused", "running"].includes(value.control.mode)) throw new EsipError("invalid_message", `${path}.control.mode is invalid`)
  requireInteger(value.control.speed, `${path}.control.speed`, { min: 1, max: 10000 })
  requireId(value.activeTimelineId, `${path}.activeTimelineId`)
  requireCivilizationState(value.state, `${path}.state`)
  if (value.specHash !== value.state.specHash || value.specId !== value.state.specId) {
    throw new EsipError("invalid_message", `${path} does not match its state ownership`)
  }
  if (!Array.isArray(value.timelines) || value.timelines.length < 1 || value.timelines.length > 256) {
    throw new EsipError("invalid_message", `${path}.timelines must contain 1-256 entries`)
  }
  let active
  value.timelines.forEach((timeline, index) => {
    const timelinePath = `${path}.timelines[${index}]`
    requireObject(timeline, timelinePath)
    rejectUnknown(timeline, [
      "timelineId", "parentTimelineId", "branchTick", "tick", "status", "historyHash",
      "checkpointCount", "latestCheckpointHash",
    ], timelinePath)
    requireId(timeline.timelineId, `${timelinePath}.timelineId`)
    if (timeline.parentTimelineId !== null) requireId(timeline.parentTimelineId, `${timelinePath}.parentTimelineId`)
    requireInteger(timeline.branchTick, `${timelinePath}.branchTick`)
    requireInteger(timeline.tick, `${timelinePath}.tick`, { min: timeline.branchTick })
    if (!["running", "completed", "collapsed"].includes(timeline.status)) throw new EsipError("invalid_message", `${timelinePath}.status is invalid`)
    for (const key of ["historyHash", "latestCheckpointHash"]) {
      requireString(timeline[key], `${timelinePath}.${key}`, { min: 8, max: 8, pattern: /^[0-9a-f]{8}$/ })
    }
    requireInteger(timeline.checkpointCount, `${timelinePath}.checkpointCount`, { min: 1 })
    if (timeline.timelineId === value.activeTimelineId) active = timeline
  })
  if (!active || active.tick !== value.state.tick || active.historyHash !== value.state.historyHash) {
    throw new EsipError("invalid_message", `${path}.activeTimelineId does not identify the supplied state`)
  }
  if (!Array.isArray(value.recentEvents) || value.recentEvents.length > 256) {
    throw new EsipError("invalid_message", `${path}.recentEvents must contain at most 256 entries`)
  }
  value.recentEvents.forEach((event, index) => requireCivilizationEvent(event, `${path}.recentEvents[${index}]`))
}

function requireCivilizationAction(data) {
  const action = data.action
  if (!["advance", "pause", "resume", "step", "set_speed", "branch", "switch_timeline"].includes(action)) {
    throw new EsipError("invalid_message", "data.action is invalid")
  }
  if (action === "advance") requireInteger(data.ticks, "data.ticks", { min: 1, max: 10000 })
  if (action === "set_speed") requireInteger(data.speed, "data.speed", { min: 1, max: 10000 })
  if (action === "branch") {
    requireId(data.newTimelineId, "data.newTimelineId")
    if (data.fromTimelineId !== undefined) requireId(data.fromTimelineId, "data.fromTimelineId")
    if (data.atTick !== undefined) requireInteger(data.atTick, "data.atTick")
  }
  if (action === "switch_timeline") requireId(data.targetTimelineId, "data.targetTimelineId")
  const allowedByAction = {
    advance: ["ticks"], set_speed: ["speed"], branch: ["newTimelineId", "fromTimelineId", "atTick"],
    switch_timeline: ["targetTimelineId"], pause: [], resume: [], step: [],
  }
  const supplied = ["ticks", "speed", "newTimelineId", "fromTimelineId", "atTick", "targetTimelineId"]
    .filter((key) => data[key] !== undefined)
  if (supplied.some((key) => !allowedByAction[action].includes(key))) {
    throw new EsipError("invalid_message", `data contains parameters not allowed for action ${action}`)
  }
}

function validatePayload(message) {
  const data = message.data
  switch (message.type) {
    case "io.evolution.capability.hello.v1":
      rejectUnknown(data, ["adapterId", "platform", "protocolVersions", "consumes", "produces", "maxMessageBytes"], "data")
      requireId(data.adapterId, "data.adapterId")
      requireString(data.platform, "data.platform", { max: 64 })
      if (!Array.isArray(data.protocolVersions) || !data.protocolVersions.includes(ESIP_VERSION)) {
        throw new EsipError("unsupported_version", `data.protocolVersions must include ${ESIP_VERSION}`)
      }
      for (const [key, values] of [["consumes", data.consumes], ["produces", data.produces]]) {
        if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length > 128)) {
          throw new EsipError("invalid_message", `data.${key} must be an array of message type patterns`)
        }
      }
      requireInteger(data.maxMessageBytes, "data.maxMessageBytes", { min: 1024, max: 16 * 1024 * 1024 })
      break
    case "io.evolution.action.requested.v1":
      rejectUnknown(data, ["context", "actionId", "parameters", "expectedRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireString(data.actionId, "data.actionId", { max: 64, pattern: ACTION_PATTERN })
      requireObject(data.parameters, "data.parameters")
      requireInteger(data.expectedRevision, "data.expectedRevision")
      break
    case "io.evolution.action.applied.v1":
      rejectUnknown(data, ["context", "commandId", "actionId", "outcome", "revision", "state"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.commandId, "data.commandId")
      requireString(data.actionId, "data.actionId", { max: 64, pattern: ACTION_PATTERN })
      if (data.outcome !== "applied") throw new EsipError("invalid_message", "data.outcome must be applied")
      requireInteger(data.revision, "data.revision")
      requireState(data.state)
      break
    case "io.evolution.state.requested.v1":
      rejectUnknown(data, ["context", "fields"], "data")
      requireContext(data.context, { actor: true })
      if (data.fields !== undefined && (!Array.isArray(data.fields) || data.fields.some((value) => typeof value !== "string"))) {
        throw new EsipError("invalid_message", "data.fields must be an array of strings")
      }
      break
    case "io.evolution.state.snapshot.v1":
      rejectUnknown(data, ["context", "respondingTo", "revision", "state"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.respondingTo, "data.respondingTo")
      requireInteger(data.revision, "data.revision")
      requireState(data.state)
      break
    case "io.evolution.realm.transitioned.v1":
      rejectUnknown(data, ["context", "fromRealm", "toRealm", "fromDimension", "toDimension", "revision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireString(data.fromRealm, "data.fromRealm", { max: 128 })
      requireString(data.toRealm, "data.toRealm", { max: 128 })
      requireInteger(data.fromDimension, "data.fromDimension", { max: 1024 })
      requireInteger(data.toDimension, "data.toDimension", { max: 1024 })
      requireInteger(data.revision, "data.revision")
      break
    case "io.evolution.timeline.create.requested.v1":
      rejectUnknown(data, ["context", "newTimelineId", "expectedStateRevision", "expectedRegistryRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.newTimelineId, "data.newTimelineId")
      requireInteger(data.expectedStateRevision, "data.expectedStateRevision")
      requireInteger(data.expectedRegistryRevision, "data.expectedRegistryRevision")
      break
    case "io.evolution.timeline.created.v1":
      rejectUnknown(data, ["context", "parentTimelineId", "newTimelineId", "branchRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.parentTimelineId, "data.parentTimelineId")
      requireId(data.newTimelineId, "data.newTimelineId")
      requireInteger(data.branchRevision, "data.branchRevision")
      break
    case "io.evolution.timeline.created.v2":
      rejectUnknown(data, ["context", "commandId", "parentTimelineId", "newTimelineId", "createdByActorId", "stateRevision", "registryRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      for (const key of ["commandId", "parentTimelineId", "newTimelineId", "createdByActorId"]) requireId(data[key], `data.${key}`)
      requireInteger(data.stateRevision, "data.stateRevision")
      requireInteger(data.registryRevision, "data.registryRevision")
      break
    case "io.evolution.timeline.join.requested.v1":
      rejectUnknown(data, ["context", "targetTimelineId", "expectedStateRevision", "expectedRegistryRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.targetTimelineId, "data.targetTimelineId")
      requireInteger(data.expectedStateRevision, "data.expectedStateRevision")
      requireInteger(data.expectedRegistryRevision, "data.expectedRegistryRevision")
      break
    case "io.evolution.timeline.joined.v1":
      rejectUnknown(data, ["context", "commandId", "fromTimelineId", "toTimelineId", "stateRevision", "registryRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      for (const key of ["commandId", "fromTimelineId", "toTimelineId"]) requireId(data[key], `data.${key}`)
      requireInteger(data.stateRevision, "data.stateRevision")
      requireInteger(data.registryRevision, "data.registryRevision")
      break
    case "io.evolution.timeline.registry.requested.v1":
      rejectUnknown(data, ["context", "afterRevision"], "data")
      requireContext(data.context, { actor: true })
      requireInteger(data.afterRevision, "data.afterRevision")
      break
    case "io.evolution.timeline.registry.snapshot.v1":
      rejectUnknown(data, ["context", "respondingTo", "registryRevision", "timelines", "events", "truncated"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.respondingTo, "data.respondingTo")
      requireInteger(data.registryRevision, "data.registryRevision")
      requireTimelineEntries(data.timelines, "data.timelines")
      requireTimelineEntries(data.events, "data.events", { allowNull: true })
      if (typeof data.truncated !== "boolean") throw new EsipError("invalid_message", "data.truncated must be boolean")
      break
    case "io.evolution.civilization.create.requested.v1":
      rejectUnknown(data, ["context", "spec", "snapshotInterval"], "data")
      requireContext(data.context, { actor: true })
      try { validateCivilizationSpec(data.spec) } catch (error) {
        throw new EsipError("invalid_message", `data.spec is invalid: ${error.message}`)
      }
      if (data.snapshotInterval !== undefined) requireInteger(data.snapshotInterval, "data.snapshotInterval", { min: 1, max: 10000 })
      break
    case "io.evolution.civilization.created.v1":
      rejectUnknown(data, ["context", "commandId", "snapshot"], "data")
      requireContext(data.context, { actor: true })
      requireId(data.commandId, "data.commandId")
      requireCivilizationSnapshot(data.snapshot)
      break
    case "io.evolution.civilization.command.requested.v1":
      rejectUnknown(data, [
        "context", "action", "expectedRevision", "ticks", "speed", "newTimelineId",
        "fromTimelineId", "atTick", "targetTimelineId",
      ], "data")
      requireContext(data.context, { actor: true })
      requireInteger(data.expectedRevision, "data.expectedRevision")
      requireCivilizationAction(data)
      break
    case "io.evolution.civilization.updated.v1":
      rejectUnknown(data, ["context", "commandId", "action", "revision", "snapshot", "events"], "data")
      requireContext(data.context, { actor: true })
      requireId(data.commandId, "data.commandId")
      if (!["advance", "pause", "resume", "step", "set_speed", "branch", "switch_timeline"].includes(data.action)) {
        throw new EsipError("invalid_message", "data.action is invalid")
      }
      requireInteger(data.revision, "data.revision")
      requireCivilizationSnapshot(data.snapshot)
      if (data.revision !== data.snapshot.revision) throw new EsipError("invalid_message", "data.revision must match data.snapshot.revision")
      if (!Array.isArray(data.events) || data.events.length > 4096) throw new EsipError("invalid_message", "data.events must contain at most 4096 entries")
      data.events.forEach((event, index) => requireCivilizationEvent(event, `data.events[${index}]`))
      break
    case "io.evolution.civilization.snapshot.requested.v1":
      rejectUnknown(data, ["context", "recentEvents"], "data")
      requireContext(data.context, { actor: true })
      if (data.recentEvents !== undefined) requireInteger(data.recentEvents, "data.recentEvents", { max: 256 })
      break
    case "io.evolution.civilization.snapshot.v1":
      rejectUnknown(data, ["context", "respondingTo", "revision", "snapshot"], "data")
      requireContext(data.context, { actor: true })
      requireId(data.respondingTo, "data.respondingTo")
      requireInteger(data.revision, "data.revision")
      requireCivilizationSnapshot(data.snapshot)
      if (data.revision !== data.snapshot.revision) throw new EsipError("invalid_message", "data.revision must match data.snapshot.revision")
      break
    case "io.evolution.error.v1":
      rejectUnknown(data, ["respondingTo", "code", "message", "retryable"], "data")
      requireId(data.respondingTo, "data.respondingTo")
      requireString(data.code, "data.code", { max: 64, pattern: /^[a-z][a-z0-9_]*$/ })
      requireString(data.message, "data.message", { max: 512 })
      if (typeof data.retryable !== "boolean") throw new EsipError("invalid_message", "data.retryable must be boolean")
      break
    default:
      throw new EsipError("unknown_type", `Unknown ESIP message type: ${message.type}`)
  }
}

export function validateEnvelope(message, { now = Date.now() } = {}) {
  requireObject(message, "message")
  rejectUnknown(message, ENVELOPE_FIELDS, "message")
  if (message.specversion !== CLOUD_EVENTS_VERSION) throw new EsipError("unsupported_version", "specversion must be 1.0")
  if (message.esipversion !== ESIP_VERSION) throw new EsipError("unsupported_version", `esipversion must be ${ESIP_VERSION}`)
  requireId(message.id, "id")
  requireString(message.source, "source", { max: 255 })
  let sourceUrl
  try { sourceUrl = new URL(message.source) } catch { throw new EsipError("invalid_message", "source must be an absolute URI") }
  if (sourceUrl.username || sourceUrl.password) throw new EsipError("invalid_message", "source must not contain credentials")
  requireString(message.type, "type", { max: 128, pattern: TYPE_PATTERN })
  if (!KINDS.includes(message.kind)) throw new EsipError("invalid_message", `kind must be one of ${KINDS.join(", ")}`)
  requireString(message.time, "time", { max: 64 })
  if (!Number.isFinite(Date.parse(message.time))) throw new EsipError("invalid_message", "time must be an ISO-8601 timestamp")
  if (message.datacontenttype !== "application/json") throw new EsipError("invalid_message", "datacontenttype must be application/json")
  requireString(message.dataschema, "dataschema", { max: 512 })
  try { new URL(message.dataschema) } catch { throw new EsipError("invalid_message", "dataschema must be an absolute URI") }
  requireInteger(message.sequence, "sequence")
  if (message.tick !== undefined) requireInteger(message.tick, "tick")
  if (message.subject !== undefined) requireString(message.subject, "subject", { max: 256 })
  if (message.target !== undefined) requireString(message.target, "target", { max: 255 })
  if ((message.kind === "command" || message.kind === "query") && !message.target) {
    throw new EsipError("invalid_message", `${message.kind} messages require target`)
  }
  for (const key of ["correlationid", "causationid"]) {
    if (message[key] !== undefined) requireId(message[key], key)
  }
  if (message.expiresat !== undefined) {
    requireString(message.expiresat, "expiresat", { max: 64 })
    const expires = Date.parse(message.expiresat)
    if (!Number.isFinite(expires)) throw new EsipError("invalid_message", "expiresat must be an ISO-8601 timestamp")
    if (expires <= now) throw new EsipError("expired", "message has expired")
  }
  requireObject(message.data, "data")
  requireJson(message.data, "data")
  return message
}

export function validateMessage(message, options = {}) {
  validateEnvelope(message, options)
  const definitions = options.definitions ?? MESSAGE_DEFINITIONS
  const definition = definitions[message.type]
  if (!definition) throw new EsipError("unknown_type", `Unknown ESIP message type: ${message.type}`)
  if (definition.kind !== message.kind) {
    throw new EsipError("kind_mismatch", `${message.type} must use kind=${definition.kind}`)
  }
  const expectedSchema = definition.dataschema ?? schemaUrlFor(message.type)
  if (!expectedSchema) throw new EsipError("invalid_registry", `${message.type} has no dataschema registration`)
  if (message.dataschema !== expectedSchema) {
    throw new EsipError("schema_mismatch", `dataschema does not match ${message.type}`)
  }
  if (typeof definition.validate === "function") definition.validate(message.data, message)
  else if (MESSAGE_DEFINITIONS[message.type]) validatePayload(message)
  else throw new EsipError("invalid_registry", `${message.type} has no payload validator`)
  return message
}
