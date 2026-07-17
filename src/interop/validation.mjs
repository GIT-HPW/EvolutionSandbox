// SPDX-License-Identifier: GPL-3.0-or-later

import { CLOUD_EVENTS_VERSION, ESIP_VERSION, KINDS, MESSAGE_DEFINITIONS, schemaUrlFor } from "./message-types.mjs"
import { EsipError } from "./errors.mjs"

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
  rejectUnknown(value, ["schema", "phase", "dimension", "energy", "information", "entropy", "stability", "fragments", "timeline", "steps"], path)
  for (const key of ["phase", "timeline"]) requireString(value[key], `${path}.${key}`, { max: 128 })
  for (const key of ["dimension", "energy", "information", "entropy", "stability", "fragments", "steps"]) {
    requireInteger(value[key], `${path}.${key}`)
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
    case "io.evolution.timeline.created.v1":
      rejectUnknown(data, ["context", "parentTimelineId", "newTimelineId", "branchRevision"], "data")
      requireContext(data.context, { actor: true, realm: true })
      requireId(data.parentTimelineId, "data.parentTimelineId")
      requireId(data.newTimelineId, "data.newTimelineId")
      requireInteger(data.branchRevision, "data.branchRevision")
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
