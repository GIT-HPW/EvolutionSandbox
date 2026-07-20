// SPDX-License-Identifier: GPL-3.0-or-later

import { applyAction, branchTimeline, createState, validatePack } from "../rules-engine.mjs"
import { EsipAdapter } from "./adapter.mjs"
import { EsipError } from "./errors.mjs"
import { TYPES } from "./message-types.mjs"

export const DEFAULT_BROWSER_STORAGE_KEY = "evolution-sandbox.esip.browser.v1"
const STORAGE_SCHEMA = 2
const PROCESSED_LIMIT = 256
const TIMELINE_LIMIT = 256
const ACTOR_LIMIT = 64
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const TIMELINE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function fingerprint(message) {
  return JSON.stringify(canonicalize(message))
}

function requireId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new EsipError("invalid_storage", `${name} must be an ESIP identifier`)
}

function requireSource(value, name) {
  try {
    const url = new URL(value)
    if (url.username || url.password) throw new Error()
  } catch {
    throw new EsipError("invalid_storage", `${name} must be an absolute URI without credentials`)
  }
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new EsipError("invalid_storage", `${name} must be a non-negative integer`)
}

function validateStoredState(pack, state) {
  if (!plainObject(state)) throw new EsipError("invalid_storage", "stored state must be an object")
  const template = createState(pack)
  if (JSON.stringify(Object.keys(template).sort()) !== JSON.stringify(Object.keys(state).sort())) {
    throw new EsipError("invalid_storage", "stored state fields do not match the content pack")
  }
  for (const [key, initial] of Object.entries(template)) {
    if (typeof state[key] !== typeof initial) throw new EsipError("invalid_storage", `stored state.${key} has the wrong type`)
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
  requireId(state.timeline, "stored state.timeline")
  return structuredClone(state)
}

function normalizeIdentities(identities) {
  if (!Array.isArray(identities) || identities.length === 0 || identities.length > ACTOR_LIMIT) {
    throw new TypeError(`identities must contain 1-${ACTOR_LIMIT} source/actor mappings`)
  }
  const sources = new Set()
  const result = identities.map(({ source, actorId }, index) => {
    try { requireSource(source, `identities[${index}].source`); requireId(actorId, `identities[${index}].actorId`) } catch (error) { throw new TypeError(error.message) }
    if (sources.has(source)) throw new TypeError("identity sources must be unique")
    sources.add(source)
    return { source, actorId }
  })
  return result
}

function newRecord(pack, universeId, identities) {
  const actorIds = [...new Set(identities.map((identity) => identity.actorId))]
  return {
    schema: STORAGE_SCHEMA,
    universeId,
    actors: actorIds.map((actorId) => ({ actorId, state: createState(pack), revision: 0 })),
    identities: structuredClone(identities),
    timelineRegistry: {
      revision: 0,
      timelines: [{ timelineId: "origin", createdByActorId: "system", registryRevision: 0 }],
      events: [],
    },
    nextSequence: 0,
    lastSequences: {},
    processed: [],
  }
}

function migrateV1(record, pack, universeId, identities) {
  if (record.universeId !== universeId) throw new EsipError("invalid_storage", "stored browser universe does not match")
  requireId(record.actorId, "stored actorId")
  requireNonNegativeInteger(record.revision, "revision")
  requireNonNegativeInteger(record.nextSequence, "nextSequence")
  const state = validateStoredState(pack, record.state)
  const mapped = identities.some((identity) => identity.actorId === record.actorId)
    ? identities
    : [{ source: "esip://browser/control", actorId: record.actorId }, ...identities]
  const timelines = [{ timelineId: "origin", createdByActorId: "system", registryRevision: 0 }]
  if (state.timeline !== "origin") {
    timelines.push({ timelineId: state.timeline, parentTimelineId: "origin", createdByActorId: record.actorId, registryRevision: 1 })
  }
  return {
    schema: STORAGE_SCHEMA,
    universeId,
    actors: [...new Set(mapped.map((identity) => identity.actorId))].map((actorId) => actorId === record.actorId
      ? { actorId, state, revision: record.revision }
      : { actorId, state: createState(pack), revision: 0 }),
    identities: mapped,
    timelineRegistry: { revision: timelines.length - 1, timelines, events: timelines.slice(1) },
    nextSequence: record.nextSequence,
    lastSequences: plainObject(record.lastSequences) ? record.lastSequences : {},
    processed: Array.isArray(record.processed) ? record.processed.slice(-PROCESSED_LIMIT) : [],
  }
}

function validateRecord(record, pack, universeId) {
  if (!plainObject(record) || record.schema !== STORAGE_SCHEMA || record.universeId !== universeId) {
    throw new EsipError("invalid_storage", "stored browser game identity or schema does not match")
  }
  requireNonNegativeInteger(record.nextSequence, "nextSequence")
  if (!Array.isArray(record.actors) || record.actors.length === 0 || record.actors.length > ACTOR_LIMIT) {
    throw new EsipError("invalid_storage", "stored actors are invalid")
  }
  const actorIds = new Set()
  for (const actor of record.actors) {
    if (!plainObject(actor)) throw new EsipError("invalid_storage", "stored actor entry is invalid")
    requireId(actor.actorId, "stored actorId")
    if (actorIds.has(actor.actorId)) throw new EsipError("invalid_storage", "stored actor ids must be unique")
    actorIds.add(actor.actorId)
    requireNonNegativeInteger(actor.revision, `actor ${actor.actorId} revision`)
    actor.state = validateStoredState(pack, actor.state)
  }
  if (!Array.isArray(record.identities) || record.identities.length === 0 || record.identities.length > ACTOR_LIMIT) {
    throw new EsipError("invalid_storage", "stored identities are invalid")
  }
  const sources = new Set()
  for (const identity of record.identities) {
    if (!plainObject(identity)) throw new EsipError("invalid_storage", "stored identity entry is invalid")
    requireSource(identity.source, "stored identity source")
    requireId(identity.actorId, "stored identity actorId")
    if (sources.has(identity.source) || !actorIds.has(identity.actorId)) throw new EsipError("invalid_storage", "stored identity mapping is inconsistent")
    sources.add(identity.source)
  }
  const registry = record.timelineRegistry
  if (!plainObject(registry)) throw new EsipError("invalid_storage", "timeline registry is missing")
  requireNonNegativeInteger(registry.revision, "timeline registry revision")
  if (!Array.isArray(registry.timelines) || registry.timelines.length === 0 || registry.timelines.length > TIMELINE_LIMIT) {
    throw new EsipError("invalid_storage", "stored timelines are invalid")
  }
  if (!Array.isArray(registry.events) || registry.events.length > TIMELINE_LIMIT) throw new EsipError("invalid_storage", "stored timeline events are invalid")
  const timelineIds = new Set()
  let highestRevision = 0
  for (const [collectionName, collection] of [["timelines", registry.timelines], ["events", registry.events]]) {
    for (const entry of collection) {
      if (!plainObject(entry)) throw new EsipError("invalid_storage", `stored ${collectionName} entry is invalid`)
      requireId(entry.timelineId, `stored ${collectionName} timelineId`)
      if (entry.parentTimelineId !== undefined) requireId(entry.parentTimelineId, `stored ${collectionName} parentTimelineId`)
      requireId(entry.createdByActorId, `stored ${collectionName} createdByActorId`)
      requireNonNegativeInteger(entry.registryRevision, `stored ${collectionName} registryRevision`)
      highestRevision = Math.max(highestRevision, entry.registryRevision)
      if (collectionName === "timelines") {
        if (timelineIds.has(entry.timelineId)) throw new EsipError("invalid_storage", "stored timeline ids must be unique")
        timelineIds.add(entry.timelineId)
      }
    }
  }
  if (!timelineIds.has("origin") || highestRevision > registry.revision) throw new EsipError("invalid_storage", "timeline registry revision is inconsistent")
  for (const actor of record.actors) {
    if (!timelineIds.has(actor.state.timeline)) throw new EsipError("invalid_storage", `actor ${actor.actorId} references an unknown timeline`)
  }
  if (!plainObject(record.lastSequences)) throw new EsipError("invalid_storage", "lastSequences must be an object")
  for (const [source, sequence] of Object.entries(record.lastSequences)) {
    requireSource(source, "stored sequence source")
    requireNonNegativeInteger(sequence, `lastSequences.${source}`)
  }
  if (!Array.isArray(record.processed) || record.processed.length > PROCESSED_LIMIT) throw new EsipError("invalid_storage", "processed command history is invalid")
  for (const entry of record.processed) {
    if (!plainObject(entry) || typeof entry.key !== "string" || typeof entry.fingerprint !== "string" || !Array.isArray(entry.responses)) {
      throw new EsipError("invalid_storage", "processed command entry is invalid")
    }
  }
  return record
}

function loadRecord(storage, storageKey, pack, universeId, identities) {
  let raw
  try { raw = storage.getItem(storageKey) } catch { throw new EsipError("storage_error", "browser storage is unavailable") }
  if (raw === null) return { record: newRecord(pack, universeId, identities), migrated: false }
  let record
  try { record = JSON.parse(raw) } catch { throw new EsipError("invalid_storage", "stored browser game state is not valid JSON") }
  const migrated = record?.schema === 1
  if (migrated) record = migrateV1(record, pack, universeId, identities)
  return { record: validateRecord(record, pack, universeId), migrated }
}

function saveRecord(storage, storageKey, record) {
  try { storage.setItem(storageKey, JSON.stringify(record)) } catch { throw new EsipError("storage_error", "browser game state could not be persisted") }
}

function responseOptions(message) {
  return { subject: message.subject, target: message.source, correlationid: message.correlationid ?? message.id, causationid: message.id }
}

function errorResponse(message, code, text, retryable) {
  return { type: TYPES.ERROR, kind: "result", data: { respondingTo: message.id, code, message: text, retryable }, options: responseOptions(message) }
}

function identityFor(record, source) {
  const identity = record.identities.find((entry) => entry.source === source)
  return identity && record.actors.find((entry) => entry.actorId === identity.actorId)
}

function contextError(message, record, actor, { requireCurrent = true } = {}) {
  const context = message.data.context
  if (context.actorId !== actor.actorId) return errorResponse(message, "actor_mismatch", "actorId does not match the authenticated source mapping", false)
  if (message.subject !== undefined && message.subject !== `actor/${actor.actorId}`) return errorResponse(message, "actor_mismatch", "subject does not match the authenticated actor", false)
  if (context.universeId !== record.universeId) return errorResponse(message, "context_conflict", "universeId does not match this browser game", true)
  if (requireCurrent && context.timelineId !== actor.state.timeline) return errorResponse(message, "context_conflict", "timelineId does not match the current actor state", true)
  if (requireCurrent && context.realmId !== undefined && context.realmId !== actor.state.phase) {
    return errorResponse(message, "context_conflict", "realmId does not match the current actor state", true)
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
  universeId = "universe-1",
  identities = [{ source: "esip://browser/control", actorId: "browser-player" }],
  primaryActorId = identities[0]?.actorId,
} = {}) {
  validatePack(pack)
  assertStorage(storage)
  requireId(universeId, "universeId")
  const configuredIdentities = normalizeIdentities(identities)
  requireId(primaryActorId, "primaryActorId")
  const loaded = loadRecord(storage, storageKey, pack, universeId, configuredIdentities)
  let record = loaded.record
  let identityConfigurationChanged = false
  for (const identity of configuredIdentities) {
    const existing = record.identities.find((entry) => entry.source === identity.source)
    if (existing && existing.actorId !== identity.actorId) throw new TypeError(`identity source ${identity.source} is already bound to another actor`)
    if (!existing) {
      if (!record.actors.some((actor) => actor.actorId === identity.actorId)) {
        if (record.actors.length >= ACTOR_LIMIT) throw new TypeError("browser actor limit reached")
        record.actors.push({ actorId: identity.actorId, state: createState(pack), revision: 0 })
      }
      record.identities.push(structuredClone(identity))
      identityConfigurationChanged = true
    }
  }
  if (!record.actors.some((actor) => actor.actorId === primaryActorId)) throw new TypeError("primaryActorId must be mapped to this browser game")
  if (loaded.migrated || identityConfigurationChanged) saveRecord(storage, storageKey, validateRecord(record, pack, universeId))

  function persist(nextRecord) {
    validateRecord(nextRecord, pack, universeId)
    saveRecord(storage, storageKey, nextRecord)
    record = nextRecord
  }

  async function emitResponses(responses, emit) {
    for (const response of responses) await emit(response.type, response.kind, response.data, response.options)
  }

  async function commit(message, responses, emit, mutate = () => {}) {
    const next = structuredClone(record)
    mutate(next)
    next.lastSequences[message.source] = message.sequence
    next.processed.push({ key: message.source + "\u0000" + message.id, fingerprint: fingerprint(message), responses: structuredClone(responses) })
    if (next.processed.length > PROCESSED_LIMIT) next.processed.splice(0, next.processed.length - PROCESSED_LIMIT)
    persist(next)
    await emitResponses(responses, emit)
  }

  function currentContext(actor) {
    return { universeId: record.universeId, actorId: actor.actorId, realmId: actor.state.phase, timelineId: actor.state.timeline }
  }

  const adapter = new EsipAdapter({
    id,
    source,
    platform: "browser",
    consumes: [
      TYPES.ACTION_REQUESTED,
      TYPES.STATE_REQUESTED,
      TYPES.TIMELINE_CREATE_REQUESTED,
      TYPES.TIMELINE_JOIN_REQUESTED,
      TYPES.TIMELINE_REGISTRY_REQUESTED,
    ],
    produces: [
      TYPES.ACTION_APPLIED,
      TYPES.STATE_SNAPSHOT,
      TYPES.REALM_TRANSITIONED,
      TYPES.TIMELINE_CREATED,
      TYPES.TIMELINE_CREATED_V2,
      TYPES.TIMELINE_JOINED,
      TYPES.TIMELINE_REGISTRY_SNAPSHOT,
      TYPES.ERROR,
    ],
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
        if (previous.fingerprint !== currentFingerprint) await emitResponses([errorResponse(message, "id_conflict", "message id was reused with different content", false)], emit)
        else await emitResponses(previous.responses, emit)
        return
      }

      const actor = identityFor(record, message.source)
      if (!actor) {
        await emitResponses([errorResponse(message, "identity_unmapped", "message source has no actor identity mapping", false)], emit)
        return
      }
      const lastSequence = record.lastSequences[message.source]
      if (lastSequence !== undefined && message.sequence <= lastSequence) {
        await emitResponses([errorResponse(message, "sequence_replay", `sequence ${message.sequence} is not newer than ${lastSequence}`, false)], emit)
        return
      }

      const isRecoveryQuery = message.type === TYPES.STATE_REQUESTED || message.type === TYPES.TIMELINE_REGISTRY_REQUESTED
      const mismatch = contextError(message, record, actor, { requireCurrent: !isRecoveryQuery })
      if (mismatch) {
        await commit(message, [mismatch], emit)
        return
      }

      if (message.type === TYPES.STATE_REQUESTED) {
        await commit(message, [{
          type: TYPES.STATE_SNAPSHOT,
          kind: "result",
          data: { context: currentContext(actor), respondingTo: message.id, revision: actor.revision, state: structuredClone(actor.state) },
          options: responseOptions(message),
        }], emit)
        return
      }

      if (message.type === TYPES.TIMELINE_REGISTRY_REQUESTED) {
        const registry = record.timelineRegistry
        if (message.data.afterRevision > registry.revision) {
          await commit(message, [errorResponse(message, "registry_revision_ahead", `afterRevision ${message.data.afterRevision} is newer than registry revision ${registry.revision}`, true)], emit)
          return
        }
        const earliest = registry.events[0]?.registryRevision ?? registry.revision + 1
        await commit(message, [{
          type: TYPES.TIMELINE_REGISTRY_SNAPSHOT,
          kind: "result",
          data: {
            context: currentContext(actor),
            respondingTo: message.id,
            registryRevision: registry.revision,
            timelines: structuredClone(registry.timelines),
            events: structuredClone(registry.events.filter((entry) => entry.registryRevision > message.data.afterRevision)),
            truncated: message.data.afterRevision < earliest - 1,
          },
          options: responseOptions(message),
        }], emit)
        return
      }

      const expectedStateRevision = message.type === TYPES.ACTION_REQUESTED
        ? message.data.expectedRevision
        : message.data.expectedStateRevision
      if (expectedStateRevision !== actor.revision) {
        await commit(message, [errorResponse(message, "revision_conflict", `expected state revision ${expectedStateRevision}, current revision is ${actor.revision}`, true)], emit)
        return
      }

      if (message.type === TYPES.TIMELINE_CREATE_REQUESTED || message.type === TYPES.TIMELINE_JOIN_REQUESTED) {
        const registry = record.timelineRegistry
        if (message.data.expectedRegistryRevision !== registry.revision) {
          await commit(message, [errorResponse(message, "registry_revision_conflict", `expected registry revision ${message.data.expectedRegistryRevision}, current revision is ${registry.revision}`, true)], emit)
          return
        }
        if (actor.state.phase !== "first_3d") {
          await commit(message, [errorResponse(message, "wrong_phase", "timelines can only be changed in the first 3D realm", false)], emit)
          return
        }

        if (message.type === TYPES.TIMELINE_CREATE_REQUESTED) {
          const newTimelineId = message.data.newTimelineId
          if (!TIMELINE_PATTERN.test(newTimelineId)) {
            await commit(message, [errorResponse(message, "invalid_timeline", "timeline id must use 1-32 letters, numbers, underscores or hyphens", false)], emit)
            return
          }
          if (registry.timelines.some((entry) => entry.timelineId === newTimelineId)) {
            await commit(message, [errorResponse(message, "timeline_exists", `timeline ${newTimelineId} already exists`, false)], emit)
            return
          }
          if (registry.timelines.length >= TIMELINE_LIMIT) {
            await commit(message, [errorResponse(message, "timeline_limit", "world timeline limit reached", false)], emit)
            return
          }
          const nextState = branchTimeline(actor.state, newTimelineId)
          const stateRevision = actor.revision + 1
          const registryRevision = registry.revision + 1
          const entry = {
            timelineId: newTimelineId,
            parentTimelineId: actor.state.timeline,
            createdByActorId: actor.actorId,
            registryRevision,
          }
          const context = { ...currentContext(actor), timelineId: newTimelineId }
          const responses = [{
            type: TYPES.TIMELINE_CREATED_V2,
            kind: "event",
            data: {
              context,
              commandId: message.id,
              parentTimelineId: actor.state.timeline,
              newTimelineId,
              createdByActorId: actor.actorId,
              stateRevision,
              registryRevision,
            },
            options: responseOptions(message),
          }]
          await commit(message, responses, emit, (next) => {
            const nextActor = next.actors.find((item) => item.actorId === actor.actorId)
            nextActor.state = nextState
            nextActor.revision = stateRevision
            next.timelineRegistry.revision = registryRevision
            next.timelineRegistry.timelines.push(entry)
            next.timelineRegistry.events.push(entry)
            if (next.timelineRegistry.events.length > TIMELINE_LIMIT) next.timelineRegistry.events.shift()
          })
          return
        }

        const targetTimelineId = message.data.targetTimelineId
        if (!registry.timelines.some((entry) => entry.timelineId === targetTimelineId)) {
          await commit(message, [errorResponse(message, "timeline_not_found", `timeline ${targetTimelineId} does not exist`, true)], emit)
          return
        }
        if (targetTimelineId === actor.state.timeline) {
          await commit(message, [errorResponse(message, "timeline_already_joined", `actor is already on timeline ${targetTimelineId}`, false)], emit)
          return
        }
        const fromTimelineId = actor.state.timeline
        const stateRevision = actor.revision + 1
        const nextState = { ...actor.state, timeline: targetTimelineId }
        await commit(message, [{
          type: TYPES.TIMELINE_JOINED,
          kind: "event",
          data: {
            context: { ...currentContext(actor), timelineId: targetTimelineId },
            commandId: message.id,
            fromTimelineId,
            toTimelineId: targetTimelineId,
            stateRevision,
            registryRevision: registry.revision,
          },
          options: responseOptions(message),
        }], emit, (next) => {
          const nextActor = next.actors.find((item) => item.actorId === actor.actorId)
          nextActor.state = nextState
          nextActor.revision = stateRevision
        })
        return
      }

      try {
        if (Object.keys(message.data.parameters).length !== 0) throw new EsipError("invalid_parameters", "this action does not accept parameters")
        const result = applyAction(pack, actor.state, message.data.actionId)
        const stateRevision = actor.revision + 1
        const context = { universeId: record.universeId, actorId: actor.actorId, realmId: result.state.phase, timelineId: result.state.timeline }
        const responses = [{
          type: TYPES.ACTION_APPLIED,
          kind: "event",
          data: { context, commandId: message.id, actionId: message.data.actionId, outcome: "applied", revision: stateRevision, state: structuredClone(result.state) },
          options: responseOptions(message),
        }]
        if (result.event.transitioned) {
          responses.push({
            type: TYPES.REALM_TRANSITIONED,
            kind: "event",
            data: { context, fromRealm: result.event.fromPhase, toRealm: result.event.toPhase, fromDimension: actor.state.dimension, toDimension: result.state.dimension, revision: stateRevision },
            options: responseOptions(message),
          })
        }
        await commit(message, responses, emit, (next) => {
          const nextActor = next.actors.find((item) => item.actorId === actor.actorId)
          nextActor.state = result.state
          nextActor.revision = stateRevision
        })
      } catch (error) {
        await commit(message, [errorResponse(message, error.code ?? "rule_error", error.message, false)], emit)
      }
    },
  })

  Object.defineProperties(adapter, {
    stateSnapshot: { get: () => structuredClone(record.actors.find((actor) => actor.actorId === primaryActorId).state) },
    revision: { get: () => record.actors.find((actor) => actor.actorId === primaryActorId).revision },
    timelineRegistrySnapshot: { get: () => structuredClone(record.timelineRegistry) },
    storageKey: { value: storageKey },
    getActorState: { value: (actorId) => structuredClone(record.actors.find((actor) => actor.actorId === actorId)?.state) },
    getActorRevision: { value: (actorId) => record.actors.find((actor) => actor.actorId === actorId)?.revision },
    registerIdentity: {
      value: (identitySource, actorId) => {
        requireSource(identitySource, "identity source")
        requireId(actorId, "actorId")
        const existing = record.identities.find((entry) => entry.source === identitySource)
        if (existing && existing.actorId !== actorId) throw new EsipError("identity_conflict", "identity source is already bound to another actor")
        if (existing) return actorId
        const next = structuredClone(record)
        if (!next.actors.some((actor) => actor.actorId === actorId)) {
          if (next.actors.length >= ACTOR_LIMIT) throw new EsipError("actor_limit", "browser actor limit reached")
          next.actors.push({ actorId, state: createState(pack), revision: 0 })
        }
        next.identities.push({ source: identitySource, actorId })
        persist(next)
        return actorId
      },
    },
    resetLocalState: {
      value: (actorId = primaryActorId) => {
        const next = structuredClone(record)
        const actor = next.actors.find((entry) => entry.actorId === actorId)
        if (!actor) throw new EsipError("actor_not_found", `actor ${actorId} is not registered`)
        actor.state = createState(pack)
        actor.revision += 1
        persist(next)
        return { state: structuredClone(actor.state), revision: actor.revision }
      },
    },
  })
  return adapter
}
