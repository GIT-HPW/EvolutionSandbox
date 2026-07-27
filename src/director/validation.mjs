// SPDX-License-Identifier: GPL-3.0-or-later

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ACTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const INTENT_TYPES = new Set(["narrative_cue", "action_suggestion", "scene_transition_request"])
const TONES = new Set(["neutral", "discovery", "warning", "milestone"])

export class DirectorError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "DirectorError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireObject(value, path) {
  if (!plainObject(value)) throw new DirectorError("invalid_director", `${path} must be an object`)
}

function requireExact(value, fields, path) {
  requireObject(value, path)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new DirectorError("invalid_director", `${path}.${key} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new DirectorError("invalid_director", `${path}.${field} is required`)
  }
}

function requireString(value, path, { min = 1, max = 256, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new DirectorError("invalid_director", `${path} is invalid`)
  }
}

function requireId(value, path) {
  requireString(value, path, { max: 128, pattern: ID_PATTERN })
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DirectorError("invalid_director", `${path} must be an integer from ${min} to ${max}`)
  }
}

function requireUniqueIds(value, path, { max = 64, action = false } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new DirectorError("invalid_director", `${path} must contain at most ${max} entries`)
  const seen = new Set()
  for (const [index, entry] of value.entries()) {
    if (action) requireString(entry, `${path}[${index}]`, { max: 64, pattern: ACTION_PATTERN })
    else requireId(entry, `${path}[${index}]`)
    if (seen.has(entry)) throw new DirectorError("invalid_director", `${path} contains duplicate ${entry}`)
    seen.add(entry)
  }
}

export function validateDirectorObservation(observation) {
  requireExact(observation, [
    "sceneId", "phase", "stateRevision", "availableActions", "completedMilestones", "availableScenes",
  ], "observation")
  requireId(observation.sceneId, "observation.sceneId")
  requireId(observation.phase, "observation.phase")
  requireInteger(observation.stateRevision, "observation.stateRevision")
  requireUniqueIds(observation.availableActions, "observation.availableActions", { action: true })
  requireUniqueIds(observation.completedMilestones, "observation.completedMilestones")
  requireUniqueIds(observation.availableScenes, "observation.availableScenes", { max: 32 })
  if (!observation.availableScenes.includes(observation.sceneId)) {
    throw new DirectorError("invalid_director", "observation.availableScenes must include the current scene")
  }
  return structuredClone(observation)
}

export function validateDirectorPolicy(policy) {
  requireExact(policy, ["schemaVersion", "id", "allowedIntentTypes", "allowedActions", "allowedScenes", "transitions"], "policy")
  if (policy.schemaVersion !== 1) throw new DirectorError("unsupported_director", "policy.schemaVersion must be 1")
  requireId(policy.id, "policy.id")
  requireUniqueIds(policy.allowedIntentTypes, "policy.allowedIntentTypes", { max: 3 })
  if (policy.allowedIntentTypes.some((type) => !INTENT_TYPES.has(type))) {
    throw new DirectorError("invalid_director", "policy.allowedIntentTypes contains an unknown intent type")
  }
  requireUniqueIds(policy.allowedActions, "policy.allowedActions", { action: true })
  requireUniqueIds(policy.allowedScenes, "policy.allowedScenes", { max: 32 })
  if (!Array.isArray(policy.transitions) || policy.transitions.length > 64) {
    throw new DirectorError("invalid_director", "policy.transitions must contain at most 64 entries")
  }
  const transitionIds = new Set()
  for (const [index, transition] of policy.transitions.entries()) {
    const path = `policy.transitions[${index}]`
    requireExact(transition, ["fromScene", "toScene", "requiredMilestone", "mode"], path)
    for (const key of ["fromScene", "toScene", "requiredMilestone"]) requireId(transition[key], `${path}.${key}`)
    if (transition.mode !== "manual_confirm") throw new DirectorError("invalid_director", `${path}.mode must be manual_confirm`)
    if (!policy.allowedScenes.includes(transition.fromScene) || !policy.allowedScenes.includes(transition.toScene)) {
      throw new DirectorError("invalid_director", `${path} references a scene outside policy.allowedScenes`)
    }
    const key = `${transition.fromScene}\0${transition.toScene}`
    if (transitionIds.has(key)) throw new DirectorError("invalid_director", "policy.transitions contains a duplicate route")
    transitionIds.add(key)
  }
  return structuredClone(policy)
}

export function validateDirectorIntent(intent) {
  requireExact(intent, ["intentId", "type", "title", "rationale", "parameters"], "intent")
  requireId(intent.intentId, "intent.intentId")
  if (!INTENT_TYPES.has(intent.type)) throw new DirectorError("invalid_director", "intent.type is invalid")
  requireString(intent.title, "intent.title", { max: 128 })
  requireString(intent.rationale, "intent.rationale", { max: 512 })
  if (intent.type === "narrative_cue") {
    requireExact(intent.parameters, ["cue", "tone"], "intent.parameters")
    requireString(intent.parameters.cue, "intent.parameters.cue", { max: 512 })
    if (!TONES.has(intent.parameters.tone)) throw new DirectorError("invalid_director", "intent.parameters.tone is invalid")
  } else if (intent.type === "action_suggestion") {
    requireExact(intent.parameters, ["actionId"], "intent.parameters")
    requireString(intent.parameters.actionId, "intent.parameters.actionId", { max: 64, pattern: ACTION_PATTERN })
  } else {
    requireExact(intent.parameters, ["fromScene", "toScene", "requiredMilestone", "mode"], "intent.parameters")
    for (const key of ["fromScene", "toScene", "requiredMilestone"]) requireId(intent.parameters[key], `intent.parameters.${key}`)
    if (intent.parameters.mode !== "manual_confirm") {
      throw new DirectorError("invalid_director", "intent.parameters.mode must be manual_confirm")
    }
  }
  return structuredClone(intent)
}
