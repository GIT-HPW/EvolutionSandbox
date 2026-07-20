// SPDX-License-Identifier: GPL-3.0-or-later

import { applyAction, branchTimeline, createState, validatePack } from "../rules-engine.mjs"
import { EsipAdapter } from "./adapter.mjs"
import { EsipError } from "./errors.mjs"
import { TYPES } from "./message-types.mjs"

export const DEFAULT_BROWSER_STORAGE_KEY = "evolution-sandbox.esip.browser.v1"
const STORAGE_SCHEMA = 1
const PROCESSED_LIMIT = 256

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function fingerprint(message) {
  return JSON.stringify(canonicalize(message))
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new EsipError("invalid_storage", `${name} must be a non-negative integer`)
}

function validateStoredState(pack, state) {
  if (!plainObject(state)) throw new EsipError("invalid_storage", "stored state must be an object")
  const template = createState(pack)
  const expectedKeys = Object.keys(template).sort()
  const actualKeys = Object.keys(state).sort()
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    throw new EsipError("invalid_storage", "stored state fields do not match the content pack")
  }
  for (const key of expectedKeys) {
    if (typeof state[key] !== typeof template[key]) throw new EsipError("invalid_storage", `stored state.${key} has the wrong type`)
    if (typeof state[key] === "number" && (!Number.isSafeInteger(state[key]) || state[key] < 0)) {
      throw new EsipError("invalid_storage", `stored state.${key} must be a non-negative integer`)
    }
  }
  const phase = pack.phases.find((item) => item.id === state.phase)
  if (!phase || state.dimension !== phase.dimension) throw new EsipError("invalid_storage", "stored phase and dimension are inconsistent")
  for (const [key, limit] of Object.entries(pack.limits)) {
    if (typeof state[key] === "number" && (state[key] < limit.min || state[key] > limit.max)) {
      throw new EsipError("invalid_storage", `stored state.${key} is outside the content limits`)
    }
  }
  return structuredClone(state)
}

function newRecord(pack, actorId, universeId) {
  return {
    schema: STORAGE_SCHEMA,
    actorId,
    universeId,
    state: createState(pack),
    revision: 0,
    nextSequence: 0,
    lastSequences: {},
    processed: [],
  }
}

function loadRecord(storage, storageKey, pack, actorId, universeId) {
  let raw
  try { raw = storage.getItem(storageKey) } catch { throw new EsipError("storage_error", "browser storage is unavailable") }
  if (raw === null) return newRecord(pack, actorId, universeId)
  let record
  try { record = JSON.parse(raw) } catch { throw new EsipError("invalid_storage", "stored browser game state is not valid JSON") }
  if (!plainObject(record) || record.schema !== STORAGE_SCHEMA || record.actorId !== actorId || record.universeId !== universeId) {
    throw new EsipError("invalid_storage", "stored browser game identity or schema does not match")
  }
  requireNonNegativeInteger(record.revision, "revision")
  requireNonNegativeInteger(record.nextSequence, "nextSequence")
  if (!plainObject(record.lastSequences)) throw new EsipError("invalid_storage", "lastSequences must be an object")
  for (const [source, sequence] of Object.entries(record.lastSequences)) {
    try { new URL(source) } catch { throw new EsipError("invalid_storage", "stored sequence source must be an absolute URI") }
    requireNonNegativeInteger(sequence, `lastSequences.${source}`)
  }
  if (!Array.isArray(record.processed) || record.processed.length > PROCESSED_LIMIT) {
    throw new EsipError("invalid_storage", "processed command history is invalid")
  }
  for (const entry of record.processed) {
    if (!plainObject(entry) || typeof entry.key !== "string" || typeof entry.fingerprint !== "string" || !Array.isArray(entry.responses)) {
      throw new EsipError("invalid_storage", "processed command entry is invalid")
    }
  }
  record.state = validateStoredState(pack, record.state)
  return record
}

function saveRecord(storage, storageKey, record) {
  try { storage.setItem(storageKey, JSON.stringify(record)) } catch { throw new EsipError("storage_error", "browser game state could not be persisted") }
}

function responseOptions(message) {
  return {
    subject: message.subject,
    target: message.source,
    correlationid: message.correlationid ?? message.id,
    causationid: message.id,
  }
}

function errorResponse(message, code, text, retryable) {
  return {
    type: TYPES.ERROR,
    kind: "result",
    data: { respondingTo: message.id, code, message: text, retryable },
    options: responseOptions(message),
  }
}

function contextError(message, record) {
  const context = message.data.context
  if (context.actorId !== record.actorId) return errorResponse(message, "actor_mismatch", "actorId is not owned by this browser game", false)
  if (context.universeId !== record.universeId) return errorResponse(message, "context_conflict", "universeId does not match this browser game", true)
  if (context.timelineId !== record.state.timeline) return errorResponse(message, "context_conflict", "timelineId does not match the current state", true)
  if (context.realmId !== undefined && context.realmId !== record.state.phase) {
    return errorResponse(message, "context_conflict", "realmId does not match the current state", true)
  }
}

function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("storage must implement getItem and setItem")
  }
}

export function createBrowserEvolutionAdapter({
  pack,
  storage = globalThis.localStorage,
  storageKey = DEFAULT_BROWSER_STORAGE_KEY,
  id = "browser-sandbox",
  source = "esip://browser/sandbox",
  actorId = "browser-player",
  universeId = "universe-1",
} = {}) {
  validatePack(pack)
  assertStorage(storage)
  let record = loadRecord(storage, storageKey, pack, actorId, universeId)

  function persist(nextRecord) {
    saveRecord(storage, storageKey, nextRecord)
    record = nextRecord
  }

  async function emitResponses(responses, emit) {
    for (const response of responses) await emit(response.type, response.kind, response.data, response.options)
  }

  async function commit(message, responses, emit, { state = record.state, revision = record.revision } = {}) {
    const next = structuredClone(record)
    next.state = structuredClone(state)
    next.revision = revision
    next.lastSequences[message.source] = message.sequence
    next.processed.push({
      key: message.source + "\u0000" + message.id,
      fingerprint: fingerprint(message),
      responses: structuredClone(responses),
    })
    if (next.processed.length > PROCESSED_LIMIT) next.processed.splice(0, next.processed.length - PROCESSED_LIMIT)
    persist(next)
    await emitResponses(responses, emit)
  }

  const adapter = new EsipAdapter({
    id,
    source,
    platform: "browser",
    consumes: [TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED],
    produces: [TYPES.ACTION_APPLIED, TYPES.STATE_SNAPSHOT, TYPES.REALM_TRANSITIONED, TYPES.TIMELINE_CREATED, TYPES.ERROR],
    initialSequence: record.nextSequence,
    sequenceChanged(nextSequence) {
      const next = structuredClone(record)
      next.nextSequence = nextSequence
      persist(next)
    },
    handle: async (message, { emit }) => {
      const key = message.source + "\u0000" + message.id
      const currentFingerprint = fingerprint(message)
      const previous = record.processed.find((entry) => entry.key === key)
      if (previous) {
        if (previous.fingerprint !== currentFingerprint) {
          await emitResponses([errorResponse(message, "id_conflict", "message id was reused with different content", false)], emit)
        } else {
          await emitResponses(previous.responses, emit)
        }
        return
      }

      const lastSequence = record.lastSequences[message.source]
      if (lastSequence !== undefined && message.sequence <= lastSequence) {
        await emitResponses([errorResponse(message, "sequence_replay", `sequence ${message.sequence} is not newer than ${lastSequence}`, false)], emit)
        return
      }

      const mismatch = contextError(message, record)
      if (mismatch) {
        await commit(message, [mismatch], emit)
        return
      }

      if (message.type === TYPES.STATE_REQUESTED) {
        await commit(message, [{
          type: TYPES.STATE_SNAPSHOT,
          kind: "result",
          data: {
            context: { ...message.data.context, realmId: record.state.phase },
            respondingTo: message.id,
            revision: record.revision,
            state: structuredClone(record.state),
          },
          options: responseOptions(message),
        }], emit)
        return
      }

      if (message.data.expectedRevision !== record.revision) {
        await commit(message, [errorResponse(message, "revision_conflict", `expected revision ${message.data.expectedRevision}, current revision is ${record.revision}`, true)], emit)
        return
      }

      try {
        const previousState = record.state
        let nextState
        let transition
        const responses = []
        if (message.data.actionId === "branch_timeline") {
          const parameters = message.data.parameters
          if (!plainObject(parameters) || Object.keys(parameters).length !== 1 || typeof parameters.name !== "string") {
            throw new EsipError("invalid_parameters", "branch_timeline requires only a string name parameter")
          }
          nextState = branchTimeline(previousState, parameters.name)
        } else {
          if (Object.keys(message.data.parameters).length !== 0) {
            throw new EsipError("invalid_parameters", "this action does not accept parameters")
          }
          const result = applyAction(pack, previousState, message.data.actionId)
          nextState = result.state
          transition = result.event.transitioned ? result.event : undefined
        }
        const revision = record.revision + 1
        const context = {
          universeId: record.universeId,
          actorId: record.actorId,
          realmId: nextState.phase,
          timelineId: nextState.timeline,
        }
        responses.push({
          type: TYPES.ACTION_APPLIED,
          kind: "event",
          data: {
            context,
            commandId: message.id,
            actionId: message.data.actionId,
            outcome: "applied",
            revision,
            state: structuredClone(nextState),
          },
          options: responseOptions(message),
        })
        if (transition) {
          responses.push({
            type: TYPES.REALM_TRANSITIONED,
            kind: "event",
            data: {
              context,
              fromRealm: transition.fromPhase,
              toRealm: transition.toPhase,
              fromDimension: previousState.dimension,
              toDimension: nextState.dimension,
              revision,
            },
            options: responseOptions(message),
          })
        }
        if (message.data.actionId === "branch_timeline") {
          responses.push({
            type: TYPES.TIMELINE_CREATED,
            kind: "event",
            data: {
              context,
              parentTimelineId: previousState.timeline,
              newTimelineId: nextState.timeline,
              branchRevision: revision,
            },
            options: responseOptions(message),
          })
        }
        await commit(message, responses, emit, { state: nextState, revision })
      } catch (error) {
        await commit(message, [errorResponse(message, error.code ?? "rule_error", error.message, false)], emit)
      }
    },
  })

  Object.defineProperties(adapter, {
    stateSnapshot: { get: () => structuredClone(record.state) },
    revision: { get: () => record.revision },
    storageKey: { value: storageKey },
    resetLocalState: {
      value: () => {
        const next = structuredClone(record)
        next.state = createState(pack)
        next.revision += 1
        persist(next)
        return { state: structuredClone(next.state), revision: next.revision }
      },
    },
  })
  return adapter
}
