// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_DIRECTOR_POLICY, decideDirectorGoal } from "../director/fake-director.mjs"
import { validateDirectorIntent, validateDirectorPolicy } from "../director/validation.mjs"
import { EsipAdapter } from "./adapter.mjs"
import { TYPES } from "./message-types.mjs"

const RECORD_SCHEMA = 1
const PROCESSED_LIMIT = 256
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function fingerprint(message) {
  return JSON.stringify(canonicalize({
    type: message.type,
    kind: message.kind,
    target: message.target,
    subject: message.subject,
    data: message.data,
  }))
}

function responseOptions(message) {
  return {
    subject: message.subject,
    target: message.source,
    correlationid: message.correlationid ?? message.id,
    causationid: message.id,
  }
}

function requireExact(value, fields, path) {
  if (!plainObject(value)) throw new TypeError(`${path} must be an object`)
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new TypeError(`${path}.${key} is not allowed`)
  for (const field of fields) if (!(field in value)) throw new TypeError(`${path}.${field} is required`)
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${path} is invalid`)
}

function requireUri(value, path) {
  if (typeof value !== "string") throw new TypeError(`${path} must be a URI`)
  let url
  try { url = new URL(value) } catch { throw new TypeError(`${path} must be a URI`) }
  if (url.username || url.password) throw new TypeError(`${path} must not include credentials`)
}

function validateStoredDecision(decision, path, revision, requestId) {
  requireExact(decision, ["context", "respondingTo", "revision", "outcome", "intent", "reasonCode", "explanation", "audit"], path)
  if (decision.respondingTo !== requestId) throw new TypeError(`${path}.respondingTo does not match the processed request`)
  requireInteger(decision.revision, `${path}.revision`, { min: 1, max: revision })
  if (!["proposed", "rejected"].includes(decision.outcome)) throw new TypeError(`${path}.outcome is invalid`)
  if (decision.outcome === "proposed") validateDirectorIntent(decision.intent)
  else if (decision.intent !== null) throw new TypeError(`${path}.intent must be null for a rejected decision`)
  requireExact(decision.context, ["universeId", "timelineId", "realmId", "actorId"], `${path}.context`)
  for (const [key, value] of Object.entries(decision.context)) {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${path}.context.${key} is invalid`)
  }
  requireExact(decision.audit, ["policyId", "engine", "requestHash", "ruleId"], `${path}.audit`)
  if (!ID_PATTERN.test(decision.audit.policyId) || decision.audit.engine !== "deterministic_fake"
    || !HASH_PATTERN.test(decision.audit.requestHash) || typeof decision.audit.ruleId !== "string"
    || decision.audit.ruleId.length < 1 || decision.audit.ruleId.length > 128) {
    throw new TypeError(`${path}.audit is invalid`)
  }
  if (typeof decision.reasonCode !== "string" || !CODE_PATTERN.test(decision.reasonCode)
    || typeof decision.explanation !== "string" || decision.explanation.length < 1 || decision.explanation.length > 512) {
    throw new TypeError(`${path} text fields are invalid`)
  }
  return structuredClone(decision)
}

function newRecord(policyId) {
  return { schemaVersion: RECORD_SCHEMA, policyId, revision: 0, processed: [] }
}

function validateRecord(input, policyId) {
  requireExact(input, ["schemaVersion", "policyId", "revision", "processed"], "director record")
  if (input.schemaVersion !== RECORD_SCHEMA) throw new TypeError(`director record schemaVersion must be ${RECORD_SCHEMA}`)
  if (input.policyId !== policyId) throw new TypeError("director record belongs to another policy")
  requireInteger(input.revision, "director record revision")
  if (!Array.isArray(input.processed) || input.processed.length > PROCESSED_LIMIT) {
    throw new TypeError(`director record processed must contain at most ${PROCESSED_LIMIT} entries`)
  }
  const keys = new Set()
  const processed = input.processed.map((entry, index) => {
    const path = `director record processed[${index}]`
    requireExact(entry, ["source", "id", "fingerprint", "decision"], path)
    requireUri(entry.source, `${path}.source`)
    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) throw new TypeError(`${path}.id is invalid`)
    if (typeof entry.fingerprint !== "string" || entry.fingerprint.length < 2 || entry.fingerprint.length > 16 * 1024) {
      throw new TypeError(`${path}.fingerprint is invalid`)
    }
    const key = `${entry.source}\0${entry.id}`
    if (keys.has(key)) throw new TypeError("director record contains duplicate request identities")
    keys.add(key)
    return { ...structuredClone(entry), decision: validateStoredDecision(entry.decision, `${path}.decision`, input.revision, entry.id) }
  })
  return { schemaVersion: RECORD_SCHEMA, policyId, revision: input.revision, processed }
}

function normalizeBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 64) {
    throw new TypeError("bindings must contain 1-64 source/actor/universe mappings")
  }
  const mapped = new Map()
  for (const [index, binding] of bindings.entries()) {
    const path = `bindings[${index}]`
    requireExact(binding, ["source", "actorId", "universeId"], path)
    requireUri(binding.source, `${path}.source`)
    for (const key of ["actorId", "universeId"]) {
      if (typeof binding[key] !== "string" || !ID_PATTERN.test(binding[key])) throw new TypeError(`${path}.${key} is invalid`)
    }
    if (mapped.has(binding.source)) throw new TypeError("bindings must not contain duplicate sources")
    mapped.set(binding.source, structuredClone(binding))
  }
  return mapped
}

export function createDirectorAdapter({
  id = "director-alpha",
  source = "esip://evolution/director-alpha",
  platform = "evolution-sandbox",
  bindings,
  policy = DEFAULT_DIRECTOR_POLICY,
  record,
  directorChanged = async () => {},
} = {}) {
  if (typeof directorChanged !== "function") throw new TypeError("directorChanged must be a function")
  const configuredPolicy = validateDirectorPolicy(policy)
  const identities = normalizeBindings(bindings)
  let current = record === undefined ? newRecord(configuredPolicy.id) : validateRecord(record, configuredPolicy.id)

  async function emitError(message, emit, code, text, retryable = false) {
    await emit(TYPES.ERROR, "result", {
      respondingTo: message.id,
      code,
      message: text,
      retryable,
    }, responseOptions(message))
  }

  const adapter = new EsipAdapter({
    id,
    source,
    platform,
    consumes: [TYPES.DIRECTOR_GOAL_REQUESTED],
    produces: [TYPES.DIRECTOR_DECIDED, TYPES.ERROR],
    handle: async (message, { emit }) => {
      const identity = identities.get(message.source)
      if (!identity) {
        await emitError(message, emit, "director_source_forbidden", "message source is not authorized to request director decisions")
        return
      }
      if (message.data.context.actorId !== identity.actorId
        || message.data.context.universeId !== identity.universeId
        || message.subject !== `actor/${identity.actorId}`) {
        await emitError(message, emit, "director_identity_mismatch", "source, actor, universe or subject does not match the director identity binding")
        return
      }

      const key = `${message.source}\0${message.id}`
      const currentFingerprint = fingerprint(message)
      const previous = current.processed.find((entry) => `${entry.source}\0${entry.id}` === key)
      if (previous) {
        if (previous.fingerprint !== currentFingerprint) {
          await emitError(message, emit, "id_conflict", "message id was reused with different director goal content")
          return
        }
        await emit(TYPES.DIRECTOR_DECIDED, "result", previous.decision, responseOptions(message))
        return
      }

      if (message.data.expectedDirectorRevision !== current.revision) {
        await emitError(
          message,
          emit,
          "revision_conflict",
          `expected director revision ${message.data.expectedDirectorRevision}, current revision is ${current.revision}`,
          true,
        )
        return
      }

      try {
        const result = decideDirectorGoal({
          goal: message.data.goal,
          observation: message.data.observation,
          policy: configuredPolicy,
        })
        const decision = {
          context: structuredClone(message.data.context),
          respondingTo: message.id,
          revision: current.revision + 1,
          ...result,
        }
        const next = structuredClone(current)
        next.revision = decision.revision
        next.processed.push({ source: message.source, id: message.id, fingerprint: currentFingerprint, decision: structuredClone(decision) })
        if (next.processed.length > PROCESSED_LIMIT) next.processed.splice(0, next.processed.length - PROCESSED_LIMIT)
        const validated = validateRecord(next, configuredPolicy.id)
        await directorChanged(structuredClone(validated), structuredClone(decision))
        current = validated
        await emit(TYPES.DIRECTOR_DECIDED, "result", decision, responseOptions(message))
      } catch (error) {
        await emitError(message, emit, error.code ?? "director_error", error.message)
      }
    },
  })

  Object.defineProperties(adapter, {
    directorRecord: { get: () => structuredClone(current) },
    directorRevision: { get: () => current.revision },
    directorPolicy: { get: () => structuredClone(configuredPolicy) },
  })
  return adapter
}
