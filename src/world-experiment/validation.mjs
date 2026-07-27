// SPDX-License-Identifier: GPL-3.0-or-later

import { hashHex } from "../civilization/prng.mjs"

export const WORLD_EXPERIMENT_SCHEMA_VERSION = 1
export const WORLD_EXPERIMENT_INTENTS = Object.freeze([
  "research_focus",
  "resource_policy",
  "settlement_policy",
  "ecology_policy",
  "cohesion_policy",
])

const PROPOSAL_FIELDS = [
  "schemaVersion", "proposalId", "universeId", "domain", "sourceTimelineId",
  "sourceTick", "sourceHistoryHash", "expectedRevision", "requestedBy",
  "intent", "magnitude", "newTimelineId", "title", "rationale",
]
const REQUESTER_FIELDS = ["type", "id"]
const REQUESTER_TYPES = new Set(["player", "director", "model"])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/

export class WorldExperimentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "WorldExperimentError"
    this.code = code
  }
}

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
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function proposalCore(proposal) {
  const { proposalId: ignored, ...core } = proposal
  return core
}

function expectedProposalId(proposal) {
  return `experiment-${hashHex(JSON.stringify(canonicalize(proposalCore(proposal))))}`
}

export function validateWorldExperimentProposal(input) {
  requireExact(input, PROPOSAL_FIELDS, "proposal")
  if (input.schemaVersion !== WORLD_EXPERIMENT_SCHEMA_VERSION) {
    throw new WorldExperimentError(
      "unsupported_experiment",
      `proposal.schemaVersion must be ${WORLD_EXPERIMENT_SCHEMA_VERSION}`,
    )
  }
  requireId(input.proposalId, "proposal.proposalId")
  requireId(input.universeId, "proposal.universeId")
  if (input.domain !== "civilization") {
    throw new WorldExperimentError("invalid_experiment", "proposal.domain must be civilization")
  }
  requireId(input.sourceTimelineId, "proposal.sourceTimelineId")
  requireInteger(input.sourceTick, "proposal.sourceTick", { max: 1000000 })
  requireString(input.sourceHistoryHash, "proposal.sourceHistoryHash", { min: 8, max: 8, pattern: HASH_PATTERN })
  requireInteger(input.expectedRevision, "proposal.expectedRevision")
  requireExact(input.requestedBy, REQUESTER_FIELDS, "proposal.requestedBy")
  if (!REQUESTER_TYPES.has(input.requestedBy.type)) {
    throw new WorldExperimentError("invalid_experiment", "proposal.requestedBy.type is invalid")
  }
  requireId(input.requestedBy.id, "proposal.requestedBy.id")
  if (!WORLD_EXPERIMENT_INTENTS.includes(input.intent)) {
    throw new WorldExperimentError("invalid_experiment", "proposal.intent is invalid")
  }
  requireInteger(input.magnitude, "proposal.magnitude", { min: 1, max: 3 })
  requireId(input.newTimelineId, "proposal.newTimelineId")
  requireString(input.title, "proposal.title", { max: 128 })
  requireString(input.rationale, "proposal.rationale", { max: 512 })
  const expected = expectedProposalId(input)
  if (input.proposalId !== expected) {
    throw new WorldExperimentError("experiment_hash_mismatch", `proposal.proposalId must be ${expected}`)
  }
  return structuredClone(input)
}

export function createWorldExperimentProposal({
  universeId,
  sourceTimelineId,
  sourceTick,
  sourceHistoryHash,
  expectedRevision,
  requestedBy,
  intent,
  magnitude,
  newTimelineId,
  title,
  rationale,
}) {
  const proposal = {
    schemaVersion: WORLD_EXPERIMENT_SCHEMA_VERSION,
    proposalId: "pending",
    universeId,
    domain: "civilization",
    sourceTimelineId,
    sourceTick,
    sourceHistoryHash,
    expectedRevision,
    requestedBy: structuredClone(requestedBy),
    intent,
    magnitude,
    newTimelineId,
    title,
    rationale,
  }
  proposal.proposalId = expectedProposalId(proposal)
  return validateWorldExperimentProposal(proposal)
}

export function worldExperimentProposalHash(input) {
  const proposal = validateWorldExperimentProposal(input)
  return hashHex(JSON.stringify(canonicalize(proposal)))
}
