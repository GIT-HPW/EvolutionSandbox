// SPDX-License-Identifier: GPL-3.0-or-later

import { hashHex } from "../civilization/prng.mjs"
import {
  validateWorldExperimentProposal,
  WORLD_EXPERIMENT_INTENTS,
  WorldExperimentError,
} from "./validation.mjs"

const PENDING_FIELDS = ["schemaVersion", "status", "proposal", "audit"]
const AUDIT_FIELDS = ["adapter", "provider", "model", "requestHash"]
const REQUEST_FIELDS = ["schemaVersion", "goal", "context", "newTimelineId"]
const CONTEXT_FIELDS = [
  "universeId", "sourceTimelineId", "sourceTick", "sourceHistoryHash",
  "expectedRevision", "allowedIntents",
]
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireExact(value, fields, path) {
  if (!plainObject(value)) throw new WorldExperimentError("invalid_experiment", `${path} must be an object`)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new WorldExperimentError("invalid_experiment", `${path}.${key} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new WorldExperimentError("invalid_experiment", `${path}.${field} is required`)
  }
}

function requireString(value, path, { min = 1, max = 128, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new WorldExperimentError("invalid_experiment", `${path} must be a valid string`)
  }
}

function requireId(value, path) {
  requireString(value, path, { pattern: ID_PATTERN })
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new WorldExperimentError("invalid_experiment", `${path} must be an integer from ${min} to ${max}`)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function requesterId(provider, model) {
  const safeModel = model.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 110) || "unknown"
  return `${provider}:${safeModel}`
}

export function validateOpenVirFactoryExperimentRequest(input) {
  requireExact(input, REQUEST_FIELDS, "request")
  if (input.schemaVersion !== 1) {
    throw new WorldExperimentError("unsupported_experiment", "request.schemaVersion must be 1")
  }
  requireString(input.goal, "request.goal", { max: 512 })
  const goal = input.goal.trim()
  if (!goal) throw new WorldExperimentError("invalid_experiment", "request.goal must not be blank")
  requireExact(input.context, CONTEXT_FIELDS, "request.context")
  requireId(input.context.universeId, "request.context.universeId")
  requireId(input.context.sourceTimelineId, "request.context.sourceTimelineId")
  requireInteger(input.context.sourceTick, "request.context.sourceTick", { max: 1000000 })
  requireString(input.context.sourceHistoryHash, "request.context.sourceHistoryHash", {
    min: 8, max: 8, pattern: HASH_PATTERN,
  })
  requireInteger(input.context.expectedRevision, "request.context.expectedRevision")
  if (!Array.isArray(input.context.allowedIntents)
    || input.context.allowedIntents.length < 1
    || input.context.allowedIntents.length > WORLD_EXPERIMENT_INTENTS.length) {
    throw new WorldExperimentError("invalid_experiment", "request.context.allowedIntents is invalid")
  }
  const seen = new Set()
  for (const [index, intent] of input.context.allowedIntents.entries()) {
    if (!WORLD_EXPERIMENT_INTENTS.includes(intent) || seen.has(intent)) {
      throw new WorldExperimentError("invalid_experiment", `request.context.allowedIntents[${index}] is invalid`)
    }
    seen.add(intent)
  }
  requireId(input.newTimelineId, "request.newTimelineId")
  return structuredClone({
    ...input,
    goal,
  })
}

export function openVirFactoryExperimentRequestHash(input) {
  return hashHex(JSON.stringify(canonicalize(validateOpenVirFactoryExperimentRequest(input))))
}

export function validateOpenVirFactoryPendingExperiment(input, {
  expectedRequest,
  expectedUniverseId,
  expectedTimelineId,
  expectedTick,
  expectedHistoryHash,
  expectedRevision,
  allowedIntents,
} = {}) {
  requireExact(input, PENDING_FIELDS, "pendingExperiment")
  if (input.schemaVersion !== 1 || input.status !== "pending") {
    throw new WorldExperimentError("invalid_experiment", "openVirFactory result must be schema 1 with status pending")
  }
  const proposal = validateWorldExperimentProposal(input.proposal)
  if (proposal.requestedBy.type !== "model") {
    throw new WorldExperimentError("experiment_provenance_mismatch", "openVirFactory proposal must declare a model requester")
  }
  requireExact(input.audit, AUDIT_FIELDS, "pendingExperiment.audit")
  if (input.audit.adapter !== "open-virfactory.world-experiment.v0") {
    throw new WorldExperimentError("experiment_provenance_mismatch", "openVirFactory adapter id is invalid")
  }
  if (!new Set(["anthropic", "ollama"]).has(input.audit.provider)) {
    throw new WorldExperimentError("experiment_provenance_mismatch", "openVirFactory provider is invalid")
  }
  requireString(input.audit.model, "pendingExperiment.audit.model")
  requireString(input.audit.requestHash, "pendingExperiment.audit.requestHash", {
    min: 8, max: 8, pattern: HASH_PATTERN,
  })
  if (proposal.requestedBy.id !== requesterId(input.audit.provider, input.audit.model)) {
    throw new WorldExperimentError("experiment_provenance_mismatch", "proposal requester does not match model audit")
  }

  if (expectedRequest !== undefined) {
    const request = validateOpenVirFactoryExperimentRequest(expectedRequest)
    if (input.audit.requestHash !== openVirFactoryExperimentRequestHash(request)) {
      throw new WorldExperimentError(
        "experiment_request_mismatch",
        "openVirFactory result does not match the originating experiment request",
      )
    }
    const requestMismatch = proposal.universeId !== request.context.universeId
      || proposal.sourceTimelineId !== request.context.sourceTimelineId
      || proposal.sourceTick !== request.context.sourceTick
      || proposal.sourceHistoryHash !== request.context.sourceHistoryHash
      || proposal.expectedRevision !== request.context.expectedRevision
      || proposal.newTimelineId !== request.newTimelineId
      || !request.context.allowedIntents.includes(proposal.intent)
    if (requestMismatch) {
      throw new WorldExperimentError(
        "experiment_request_mismatch",
        "openVirFactory proposal does not match the originating experiment request",
      )
    }
  }

  const sourceMismatch = (expectedUniverseId !== undefined && proposal.universeId !== expectedUniverseId)
    || (expectedTimelineId !== undefined && proposal.sourceTimelineId !== expectedTimelineId)
    || (expectedTick !== undefined && proposal.sourceTick !== expectedTick)
    || (expectedHistoryHash !== undefined && proposal.sourceHistoryHash !== expectedHistoryHash)
  if (sourceMismatch) {
    throw new WorldExperimentError("experiment_source_mismatch", "openVirFactory proposal does not match current authority source")
  }
  if (expectedRevision !== undefined && proposal.expectedRevision !== expectedRevision) {
    throw new WorldExperimentError("experiment_revision_mismatch", "openVirFactory proposal revision is stale")
  }
  if (allowedIntents !== undefined && !new Set(allowedIntents).has(proposal.intent)) {
    throw new WorldExperimentError("experiment_intent_forbidden", `proposal intent ${proposal.intent} is not allowed`)
  }
  return structuredClone({ ...input, proposal })
}
