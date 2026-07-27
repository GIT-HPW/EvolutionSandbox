// SPDX-License-Identifier: GPL-3.0-or-later

import { validateCivilizationSpec } from "../civilization/validation.mjs"
import {
  validateWorldExperimentProposal,
  worldExperimentProposalHash,
  WorldExperimentError,
} from "./validation.mjs"

export const CIVILIZATION_POLICY_FIELDS = Object.freeze([
  "knowledge", "ecology", "expansion", "militarism", "collectivism",
])

export const CIVILIZATION_EXPERIMENT_CATALOG = Object.freeze({
  research_focus: Object.freeze({
    label: "知识优先",
    summary: "提高知识投入，同时略微收缩扩张倾向。",
    patch: Object.freeze({ knowledge: 8, ecology: 0, expansion: -2, militarism: 0, collectivism: 0 }),
  }),
  resource_policy: Object.freeze({
    label: "资源开拓",
    summary: "提高扩张与资源产出倾向，同时承担生态压力。",
    patch: Object.freeze({ knowledge: 0, ecology: -3, expansion: 8, militarism: 0, collectivism: 0 }),
  }),
  settlement_policy: Object.freeze({
    label: "聚落协作",
    summary: "同时提高温和扩张与集体协作倾向。",
    patch: Object.freeze({ knowledge: 0, ecology: 0, expansion: 4, militarism: 0, collectivism: 5 }),
  }),
  ecology_policy: Object.freeze({
    label: "生态修复",
    summary: "提高生态优先级，同时收缩扩张倾向。",
    patch: Object.freeze({ knowledge: 0, ecology: 8, expansion: -3, militarism: 0, collectivism: 0 }),
  }),
  cohesion_policy: Object.freeze({
    label: "公共协商",
    summary: "提高集体协作，并降低军事化倾向。",
    patch: Object.freeze({ knowledge: 0, ecology: 0, expansion: 0, militarism: -3, collectivism: 8 }),
  }),
})

const CAUSALITY_FIELDS = [
  "schemaVersion", "kind", "proposal", "proposalHash", "patch", "committedRevision",
]
const ID_PATTERN = /^[0-9a-f]{8}$/

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function neutralCivilizationPolicy() {
  return Object.fromEntries(CIVILIZATION_POLICY_FIELDS.map((key) => [key, 0]))
}

export function validateCivilizationRulePatch(input, path = "patch") {
  if (!plainObject(input)) throw new WorldExperimentError("invalid_experiment", `${path} must be an object`)
  const unknown = Object.keys(input).filter((key) => !CIVILIZATION_POLICY_FIELDS.includes(key))
  if (unknown.length > 0) throw new WorldExperimentError("invalid_experiment", `${path}.${unknown[0]} is not allowed`)
  for (const key of CIVILIZATION_POLICY_FIELDS) {
    if (!Number.isSafeInteger(input[key]) || input[key] < -100 || input[key] > 100) {
      throw new WorldExperimentError("invalid_experiment", `${path}.${key} must be an integer from -100 to 100`)
    }
  }
  return structuredClone(input)
}

export function compileCivilizationRulePatch(input, proposalInput) {
  const spec = validateCivilizationSpec(input)
  const proposal = validateWorldExperimentProposal(proposalInput)
  if (!spec.autonomy.allowedIntents.includes(proposal.intent)) {
    throw new WorldExperimentError(
      "experiment_intent_forbidden",
      `civilization ${spec.id} does not allow ${proposal.intent}`,
    )
  }
  const template = CIVILIZATION_EXPERIMENT_CATALOG[proposal.intent]
  return validateCivilizationRulePatch(Object.fromEntries(
    CIVILIZATION_POLICY_FIELDS.map((key) => [key, template.patch[key] * proposal.magnitude]),
  ))
}

export function mergeCivilizationPolicy(input, currentInput, patchInput) {
  const spec = validateCivilizationSpec(input)
  const current = validateCivilizationRulePatch(currentInput, "currentPolicy")
  const patch = validateCivilizationRulePatch(patchInput)
  return Object.fromEntries(CIVILIZATION_POLICY_FIELDS.map((key) => {
    const effective = Math.max(0, Math.min(100, spec.values[key] + current[key] + patch[key]))
    return [key, effective - spec.values[key]]
  }))
}

export function effectiveCivilizationValues(input, policyInput = neutralCivilizationPolicy()) {
  const spec = validateCivilizationSpec(input)
  const policy = validateCivilizationRulePatch(policyInput, "policy")
  return Object.fromEntries(CIVILIZATION_POLICY_FIELDS.map((key) => [
    key,
    Math.max(0, Math.min(100, spec.values[key] + policy[key])),
  ]))
}

export function listCivilizationExperimentIntents(input) {
  const spec = validateCivilizationSpec(input)
  return spec.autonomy.allowedIntents.map((id) => ({
    id,
    label: CIVILIZATION_EXPERIMENT_CATALOG[id].label,
    summary: CIVILIZATION_EXPERIMENT_CATALOG[id].summary,
  }))
}

export function createCivilizationExperimentCausality(input, proposalInput, committedRevision) {
  const proposal = validateWorldExperimentProposal(proposalInput)
  if (!Number.isSafeInteger(committedRevision) || committedRevision !== proposal.expectedRevision + 1) {
    throw new WorldExperimentError(
      "invalid_experiment",
      "committedRevision must immediately follow proposal.expectedRevision",
    )
  }
  return {
    schemaVersion: 1,
    kind: "world_experiment",
    proposal,
    proposalHash: worldExperimentProposalHash(proposal),
    patch: compileCivilizationRulePatch(input, proposal),
    committedRevision,
  }
}

export function validateCivilizationExperimentCausality(input, causality) {
  if (!plainObject(causality)) throw new WorldExperimentError("invalid_experiment", "causality must be an object")
  const keys = Object.keys(causality)
  if (keys.some((key) => !CAUSALITY_FIELDS.includes(key)) || CAUSALITY_FIELDS.some((key) => !(key in causality))) {
    throw new WorldExperimentError("invalid_experiment", "causality fields are invalid")
  }
  if (causality.schemaVersion !== 1 || causality.kind !== "world_experiment") {
    throw new WorldExperimentError("invalid_experiment", "causality version or kind is invalid")
  }
  const proposal = validateWorldExperimentProposal(causality.proposal)
  if (typeof causality.proposalHash !== "string" || !ID_PATTERN.test(causality.proposalHash)
    || causality.proposalHash !== worldExperimentProposalHash(proposal)) {
    throw new WorldExperimentError("experiment_hash_mismatch", "causality.proposalHash does not match its proposal")
  }
  const patch = validateCivilizationRulePatch(causality.patch)
  if (!equalJson(patch, compileCivilizationRulePatch(input, proposal))) {
    throw new WorldExperimentError("experiment_patch_mismatch", "causality.patch does not match its bounded intent")
  }
  if (!Number.isSafeInteger(causality.committedRevision)
    || causality.committedRevision !== proposal.expectedRevision + 1) {
    throw new WorldExperimentError("invalid_experiment", "causality.committedRevision is invalid")
  }
  return structuredClone(causality)
}
