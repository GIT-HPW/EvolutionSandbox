// SPDX-License-Identifier: GPL-3.0-or-later

import { validateDirectorIntent, validateDirectorObservation } from "./validation.mjs"
import { hashHex } from "../determinism/prng.mjs"

const RECORD_SCHEMA = 1
const TICKET_LIMIT = 256
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const ACTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const STATUSES = new Set(["pending", "declined", "executing", "executed", "failed"])

export class DirectorApprovalError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "DirectorApprovalError"
    this.code = code
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireExact(value, fields, path) {
  if (!plainObject(value)) throw new DirectorApprovalError("invalid_approval", `${path} must be an object`)
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) throw new DirectorApprovalError("invalid_approval", `${path}.${key} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new DirectorApprovalError("invalid_approval", `${path}.${field} is required`)
  }
}

function requireString(value, path, { min = 1, max = 256, pattern } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    throw new DirectorApprovalError("invalid_approval", `${path} is invalid`)
  }
  return value
}

function requireId(value, path) {
  return requireString(value, path, { max: 160, pattern: ID_PATTERN })
}

function requireInteger(value, path, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new DirectorApprovalError("invalid_approval", `${path} must be an integer greater than or equal to ${min}`)
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function fingerprint(value) {
  return JSON.stringify(canonicalize(value))
}

function equal(left, right) {
  return fingerprint(left) === fingerprint(right)
}

function validateContext(context, path = "context") {
  requireExact(context, ["universeId", "timelineId", "realmId", "actorId"], path)
  for (const key of ["universeId", "timelineId", "realmId", "actorId"]) requireId(context[key], `${path}.${key}`)
  return structuredClone(context)
}

function validateAudit(audit, path = "audit") {
  requireExact(audit, ["policyId", "engine", "requestHash", "ruleId"], path)
  requireId(audit.policyId, `${path}.policyId`)
  if (audit.engine !== "deterministic_fake") {
    throw new DirectorApprovalError("invalid_approval", `${path}.engine is not trusted by this approval gate`)
  }
  requireString(audit.requestHash, `${path}.requestHash`, { min: 8, max: 8, pattern: HASH_PATTERN })
  requireString(audit.ruleId, `${path}.ruleId`, { max: 128 })
  return structuredClone(audit)
}

function validateProposal(input) {
  requireExact(input, ["requestId", "context", "observation", "decision"], "proposal")
  requireId(input.requestId, "proposal.requestId")
  const context = validateContext(input.context, "proposal.context")
  const observation = validateDirectorObservation(input.observation)
  if (context.realmId !== observation.phase) {
    throw new DirectorApprovalError("context_mismatch", "proposal context realm does not match its authority observation")
  }

  const decision = input.decision
  requireExact(decision, [
    "context", "respondingTo", "revision", "outcome", "intent", "reasonCode", "explanation", "audit",
  ], "proposal.decision")
  const decisionContext = validateContext(decision.context, "proposal.decision.context")
  if (!equal(context, decisionContext) || decision.respondingTo !== input.requestId) {
    throw new DirectorApprovalError("decision_mismatch", "director decision does not belong to this request and context")
  }
  requireInteger(decision.revision, "proposal.decision.revision", { min: 1 })
  if (decision.outcome !== "proposed" || decision.reasonCode !== "intent_proposed") {
    throw new DirectorApprovalError("decision_not_proposed", "only proposed director intents can enter approval")
  }
  requireString(decision.explanation, "proposal.decision.explanation", { max: 512 })
  const intent = validateDirectorIntent(decision.intent)
  const audit = validateAudit(decision.audit, "proposal.decision.audit")
  return {
    requestId: input.requestId,
    context,
    observation,
    decision: {
      context: decisionContext,
      respondingTo: decision.respondingTo,
      revision: decision.revision,
      outcome: decision.outcome,
      intent,
      reasonCode: decision.reasonCode,
      explanation: decision.explanation,
      audit,
    },
  }
}

function validateReview(review, path = "review") {
  if (review === null) return null
  requireExact(review, ["choice", "reviewerId", "reviewedAt"], path)
  if (!["approve", "decline"].includes(review.choice)) {
    throw new DirectorApprovalError("invalid_approval", `${path}.choice is invalid`)
  }
  requireId(review.reviewerId, `${path}.reviewerId`)
  requireString(review.reviewedAt, `${path}.reviewedAt`, { max: 64 })
  return structuredClone(review)
}

function validatePlan(plan, ticket, path = "execution.plan") {
  const shared = ["type", "intentId", "context", "expectedStateRevision"]
  const intent = ticket.intent
  if (intent.type === "action_suggestion") {
    requireExact(plan, [...shared, "actionId"], path)
    if (plan.type !== "action_command" || plan.actionId !== intent.parameters.actionId) {
      throw new DirectorApprovalError("invalid_approval", `${path} does not match the action intent`)
    }
    requireString(plan.actionId, `${path}.actionId`, { max: 64, pattern: ACTION_PATTERN })
  } else if (intent.type === "scene_transition_request") {
    requireExact(plan, [...shared, "fromScene", "toScene", "requiredMilestone", "mode"], path)
    if (plan.type !== "scene_transition_permit"
      || !equal({
        fromScene: plan.fromScene,
        toScene: plan.toScene,
        requiredMilestone: plan.requiredMilestone,
        mode: plan.mode,
      }, intent.parameters)) {
      throw new DirectorApprovalError("invalid_approval", `${path} does not match the scene transition intent`)
    }
  } else {
    requireExact(plan, [...shared, "cue", "tone"], path)
    if (plan.type !== "narrative_release" || plan.cue !== intent.parameters.cue || plan.tone !== intent.parameters.tone) {
      throw new DirectorApprovalError("invalid_approval", `${path} does not match the narrative intent`)
    }
  }
  requireId(plan.intentId, `${path}.intentId`)
  if (plan.intentId !== intent.intentId) throw new DirectorApprovalError("invalid_approval", `${path}.intentId does not match the ticket`)
  const context = validateContext(plan.context, `${path}.context`)
  if (!equal(context, ticket.context)) throw new DirectorApprovalError("invalid_approval", `${path}.context does not match the ticket`)
  requireInteger(plan.expectedStateRevision, `${path}.expectedStateRevision`)
  if (plan.expectedStateRevision !== ticket.observation.stateRevision) {
    throw new DirectorApprovalError("invalid_approval", `${path}.expectedStateRevision does not match the ticket`)
  }
  return structuredClone(plan)
}

function normalizeJson(value, path) {
  if (value === undefined) return null
  let encoded
  try { encoded = JSON.stringify(value) } catch {
    throw new DirectorApprovalError("invalid_execution_result", `${path} must be JSON serializable`)
  }
  if (encoded === undefined || encoded.length > 64 * 1024) {
    throw new DirectorApprovalError("invalid_execution_result", `${path} is empty or too large`)
  }
  return JSON.parse(encoded)
}

function validateExecution(execution, ticket, status, path = "execution") {
  if (execution === null) return null
  requireExact(execution, ["plan", "startedAt", "finishedAt", "result", "error"], path)
  const plan = validatePlan(execution.plan, ticket, `${path}.plan`)
  requireString(execution.startedAt, `${path}.startedAt`, { max: 64 })
  if (status === "executing") {
    if (execution.finishedAt !== null || execution.result !== null || execution.error !== null) {
      throw new DirectorApprovalError("invalid_approval", `${path} executing fields are inconsistent`)
    }
  } else {
    requireString(execution.finishedAt, `${path}.finishedAt`, { max: 64 })
    if (status === "executed") {
      if (execution.error !== null) throw new DirectorApprovalError("invalid_approval", `${path}.error must be null after success`)
      normalizeJson(execution.result, `${path}.result`)
    } else if (status === "failed") {
      if (execution.result !== null) throw new DirectorApprovalError("invalid_approval", `${path}.result must be null after failure`)
      requireExact(execution.error, ["code", "message"], `${path}.error`)
      requireString(execution.error.code, `${path}.error.code`, { max: 64, pattern: CODE_PATTERN })
      requireString(execution.error.message, `${path}.error.message`, { max: 512 })
    }
  }
  return { ...structuredClone(execution), plan }
}

function validateTicket(ticket, path) {
  requireExact(ticket, [
    "ticketId", "fingerprint", "requestId", "context", "observation", "decisionRevision", "intent", "audit",
    "status", "createdAt", "updatedAt", "review", "execution",
  ], path)
  requireId(ticket.ticketId, `${path}.ticketId`)
  requireString(ticket.fingerprint, `${path}.fingerprint`, { min: 2, max: 32 * 1024 })
  requireId(ticket.requestId, `${path}.requestId`)
  const context = validateContext(ticket.context, `${path}.context`)
  const observation = validateDirectorObservation(ticket.observation)
  if (context.realmId !== observation.phase) throw new DirectorApprovalError("invalid_approval", `${path} context and observation disagree`)
  requireInteger(ticket.decisionRevision, `${path}.decisionRevision`, { min: 1 })
  const intent = validateDirectorIntent(ticket.intent)
  const audit = validateAudit(ticket.audit, `${path}.audit`)
  if (!STATUSES.has(ticket.status)) throw new DirectorApprovalError("invalid_approval", `${path}.status is invalid`)
  requireString(ticket.createdAt, `${path}.createdAt`, { max: 64 })
  requireString(ticket.updatedAt, `${path}.updatedAt`, { max: 64 })
  const review = validateReview(ticket.review, `${path}.review`)
  const base = { ...structuredClone(ticket), context, observation, intent, audit, review }
  const execution = validateExecution(ticket.execution, base, ticket.status, `${path}.execution`)

  if (ticket.status === "pending" && (review !== null || execution !== null)) {
    throw new DirectorApprovalError("invalid_approval", `${path} pending fields are inconsistent`)
  }
  if (ticket.status === "declined" && (review?.choice !== "decline" || execution !== null)) {
    throw new DirectorApprovalError("invalid_approval", `${path} declined fields are inconsistent`)
  }
  if (["executing", "executed", "failed"].includes(ticket.status) && (review?.choice !== "approve" || execution === null)) {
    throw new DirectorApprovalError("invalid_approval", `${path} approved fields are inconsistent`)
  }
  return { ...base, execution }
}

function newRecord() {
  return { schemaVersion: RECORD_SCHEMA, revision: 0, tickets: [] }
}

export function validateDirectorApprovalRecord(record) {
  requireExact(record, ["schemaVersion", "revision", "tickets"], "approval record")
  if (record.schemaVersion !== RECORD_SCHEMA) {
    throw new DirectorApprovalError("unsupported_approval", `approval record schemaVersion must be ${RECORD_SCHEMA}`)
  }
  requireInteger(record.revision, "approval record.revision")
  if (!Array.isArray(record.tickets) || record.tickets.length > TICKET_LIMIT) {
    throw new DirectorApprovalError("invalid_approval", `approval record.tickets must contain at most ${TICKET_LIMIT} entries`)
  }
  const ids = new Set()
  const tickets = record.tickets.map((ticket, index) => {
    const validated = validateTicket(ticket, `approval record.tickets[${index}]`)
    if (ids.has(validated.ticketId)) throw new DirectorApprovalError("invalid_approval", "approval record contains duplicate ticket ids")
    ids.add(validated.ticketId)
    return validated
  })
  return { schemaVersion: RECORD_SCHEMA, revision: record.revision, tickets }
}

function nowString(now) {
  return requireString(now(), "now()", { max: 64 })
}

function assertFresh(ticket, observation) {
  if (observation.sceneId !== ticket.observation.sceneId
    || observation.phase !== ticket.observation.phase
    || observation.stateRevision !== ticket.observation.stateRevision) {
    throw new DirectorApprovalError("stale_observation", "authority state changed after the director made this proposal")
  }
  const intent = ticket.intent
  if (intent.type === "action_suggestion" && !observation.availableActions.includes(intent.parameters.actionId)) {
    throw new DirectorApprovalError("action_unavailable", "the proposed action is no longer available to the authority")
  }
  if (intent.type === "scene_transition_request") {
    const parameters = intent.parameters
    if (parameters.mode !== "manual_confirm"
      || observation.sceneId !== parameters.fromScene
      || !observation.availableScenes.includes(parameters.toScene)
      || !observation.completedMilestones.includes(parameters.requiredMilestone)) {
      throw new DirectorApprovalError("transition_unavailable", "the proposed scene transition is no longer authorized")
    }
  }
}

function authorityPlan(ticket) {
  const shared = {
    intentId: ticket.intent.intentId,
    context: structuredClone(ticket.context),
    expectedStateRevision: ticket.observation.stateRevision,
  }
  if (ticket.intent.type === "action_suggestion") {
    return { type: "action_command", ...shared, actionId: ticket.intent.parameters.actionId }
  }
  if (ticket.intent.type === "scene_transition_request") {
    return { type: "scene_transition_permit", ...shared, ...structuredClone(ticket.intent.parameters) }
  }
  return { type: "narrative_release", ...shared, ...structuredClone(ticket.intent.parameters) }
}

function errorDetails(error) {
  const candidate = typeof error?.code === "string" && CODE_PATTERN.test(error.code) ? error.code : "executor_error"
  const message = typeof error?.message === "string" && error.message.length > 0
    ? error.message.slice(0, 512)
    : "authority executor failed without an error message"
  return { code: candidate, message }
}

export function createDirectorApprovalGate({
  record,
  observe,
  executeAction = async () => { throw new DirectorApprovalError("executor_unavailable", "action executor is not configured") },
  publishNarrative = async () => { throw new DirectorApprovalError("executor_unavailable", "narrative publisher is not configured") },
  prepareSceneTransition = async () => { throw new DirectorApprovalError("executor_unavailable", "scene transition authority is not configured") },
  approvalChanged = async () => {},
  now = () => new Date().toISOString(),
} = {}) {
  for (const [name, callback] of Object.entries({ observe, executeAction, publishNarrative, prepareSceneTransition, approvalChanged, now })) {
    if (typeof callback !== "function") throw new TypeError(`${name} must be a function`)
  }
  let current = record === undefined ? newRecord() : validateDirectorApprovalRecord(record)
  let queue = Promise.resolve()

  function enqueue(operation) {
    const pending = queue.then(operation, operation)
    queue = pending.catch(() => {})
    return pending
  }

  async function persist(next, event) {
    const validated = validateDirectorApprovalRecord(next)
    await approvalChanged(structuredClone(validated), structuredClone(event))
    current = validated
  }

  function ticketById(ticketId) {
    return current.tickets.find((ticket) => ticket.ticketId === ticketId)
  }

  async function stageInternal(input) {
    const proposal = validateProposal(input)
    const ticketId = `approval-${proposal.decision.intent.intentId}-${hashHex(proposal.requestId)}`
    requireId(ticketId, "ticketId")
    const proposalFingerprint = fingerprint(proposal)
    const previous = ticketById(ticketId)
    if (previous) {
      if (previous.fingerprint !== proposalFingerprint) {
        throw new DirectorApprovalError("ticket_conflict", "director intent id was reused with different proposal content")
      }
      return structuredClone(previous)
    }

    const timestamp = nowString(now)
    const ticket = {
      ticketId,
      fingerprint: proposalFingerprint,
      requestId: proposal.requestId,
      context: proposal.context,
      observation: proposal.observation,
      decisionRevision: proposal.decision.revision,
      intent: proposal.decision.intent,
      audit: proposal.decision.audit,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
      review: null,
      execution: null,
    }
    const next = structuredClone(current)
    if (next.tickets.length >= TICKET_LIMIT) {
      const removable = next.tickets.findIndex((entry) => !["pending", "executing"].includes(entry.status))
      if (removable < 0) throw new DirectorApprovalError("approval_capacity", "approval gate has no room for another pending ticket")
      next.tickets.splice(removable, 1)
    }
    next.revision += 1
    next.tickets.push(ticket)
    await persist(next, { type: "ticket_staged", ticketId, status: "pending", revision: next.revision })
    return structuredClone(ticketById(ticketId))
  }

  async function executePlan(ticket, plan) {
    if (plan.type === "action_command") return executeAction(structuredClone(plan))
    if (plan.type === "scene_transition_permit") return prepareSceneTransition(structuredClone(plan))
    return publishNarrative(structuredClone(plan))
  }

  async function reviewInternal(ticketId, input) {
    requireId(ticketId, "ticketId")
    requireExact(input, ["choice", "reviewerId"], "review request")
    if (!["approve", "decline"].includes(input.choice)) {
      throw new DirectorApprovalError("invalid_review", "review choice must be approve or decline")
    }
    requireId(input.reviewerId, "review request.reviewerId")
    const ticket = ticketById(ticketId)
    if (!ticket) throw new DirectorApprovalError("ticket_not_found", `approval ticket ${ticketId} does not exist`)
    if (input.reviewerId !== ticket.context.actorId) {
      throw new DirectorApprovalError("reviewer_forbidden", "only the actor bound to this proposal can review it")
    }
    if (ticket.status !== "pending") {
      if (ticket.status === "executing") {
        throw new DirectorApprovalError("reconciliation_required", "ticket execution began but has no final audited outcome")
      }
      if (ticket.review?.choice === input.choice && ticket.review.reviewerId === input.reviewerId) return structuredClone(ticket)
      throw new DirectorApprovalError("ticket_closed", `approval ticket is already ${ticket.status}`)
    }

    const reviewedAt = nowString(now)
    const review = { choice: input.choice, reviewerId: input.reviewerId, reviewedAt }
    if (input.choice === "decline") {
      const next = structuredClone(current)
      const nextTicket = next.tickets.find((entry) => entry.ticketId === ticketId)
      next.revision += 1
      nextTicket.status = "declined"
      nextTicket.updatedAt = reviewedAt
      nextTicket.review = review
      await persist(next, { type: "ticket_declined", ticketId, status: "declined", revision: next.revision })
      return structuredClone(ticketById(ticketId))
    }

    const authorityObservation = validateDirectorObservation(await observe(structuredClone(ticket.context)))
    assertFresh(ticket, authorityObservation)
    const plan = authorityPlan(ticket)
    const executing = structuredClone(current)
    const executingTicket = executing.tickets.find((entry) => entry.ticketId === ticketId)
    executing.revision += 1
    executingTicket.status = "executing"
    executingTicket.updatedAt = reviewedAt
    executingTicket.review = review
    executingTicket.execution = { plan, startedAt: reviewedAt, finishedAt: null, result: null, error: null }
    await persist(executing, { type: "ticket_execution_started", ticketId, status: "executing", revision: executing.revision })

    let result
    try {
      result = normalizeJson(await executePlan(executingTicket, plan), "executor result")
    } catch (error) {
      const failedAt = nowString(now)
      const failed = structuredClone(current)
      const failedTicket = failed.tickets.find((entry) => entry.ticketId === ticketId)
      failed.revision += 1
      failedTicket.status = "failed"
      failedTicket.updatedAt = failedAt
      failedTicket.execution.finishedAt = failedAt
      failedTicket.execution.error = errorDetails(error)
      try {
        await persist(failed, { type: "ticket_execution_failed", ticketId, status: "failed", revision: failed.revision })
      } catch {
        throw new DirectorApprovalError("reconciliation_required", "execution failed and its final audit record could not be persisted")
      }
      throw new DirectorApprovalError("execution_failed", failedTicket.execution.error.message)
    }

    const finishedAt = nowString(now)
    const completed = structuredClone(current)
    const completedTicket = completed.tickets.find((entry) => entry.ticketId === ticketId)
    completed.revision += 1
    completedTicket.status = "executed"
    completedTicket.updatedAt = finishedAt
    completedTicket.execution.finishedAt = finishedAt
    completedTicket.execution.result = result
    try {
      await persist(completed, { type: "ticket_execution_completed", ticketId, status: "executed", revision: completed.revision })
    } catch {
      throw new DirectorApprovalError("reconciliation_required", "authority execution completed but its final audit record could not be persisted")
    }
    return structuredClone(ticketById(ticketId))
  }

  return Object.freeze({
    stage: (input) => enqueue(() => stageInternal(input)),
    review: (ticketId, input) => enqueue(() => reviewInternal(ticketId, input)),
    getTicket(ticketId) {
      requireId(ticketId, "ticketId")
      const ticket = ticketById(ticketId)
      return ticket ? structuredClone(ticket) : undefined
    },
    get record() { return structuredClone(current) },
    get revision() { return current.revision },
    get pendingTickets() { return current.tickets.filter((ticket) => ticket.status === "pending").map((ticket) => structuredClone(ticket)) },
  })
}
