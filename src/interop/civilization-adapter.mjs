// SPDX-License-Identifier: GPL-3.0-or-later

import { CivilizationController } from "../civilization/controller.mjs"
import {
  compileCivilizationRulePatch,
  validateWorldExperimentProposal,
} from "../world-experiment/index.mjs"
import { EsipAdapter } from "./adapter.mjs"
import { TYPES } from "./message-types.mjs"

function responseOptions(message) {
  return {
    subject: message.subject,
    target: message.source,
    correlationid: message.correlationid ?? message.id,
    causationid: message.id,
  }
}

const EXPERIMENT_REQUEST_TYPES = new Set([
  TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED,
  TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED,
])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function normalizeExperimentBindings(bindings = []) {
  if (!Array.isArray(bindings) || bindings.length > 64) {
    throw new TypeError("experimentBindings must contain at most 64 source/actor/universe mappings")
  }
  const mapped = new Map()
  for (const [index, binding] of bindings.entries()) {
    if (binding === null || typeof binding !== "object" || Array.isArray(binding)) {
      throw new TypeError(`experimentBindings[${index}] must be an object`)
    }
    const fields = ["source", "actorId", "universeId"]
    if (Object.keys(binding).some((key) => !fields.includes(key)) || fields.some((key) => !(key in binding))) {
      throw new TypeError(`experimentBindings[${index}] fields are invalid`)
    }
    let url
    try { url = new URL(binding.source) } catch { throw new TypeError(`experimentBindings[${index}].source must be a URI`) }
    if (url.username || url.password) throw new TypeError(`experimentBindings[${index}].source must not contain credentials`)
    for (const key of ["actorId", "universeId"]) {
      if (typeof binding[key] !== "string" || !ID_PATTERN.test(binding[key])) {
        throw new TypeError(`experimentBindings[${index}].${key} is invalid`)
      }
    }
    if (mapped.has(binding.source)) throw new TypeError("experimentBindings must not contain duplicate sources")
    mapped.set(binding.source, structuredClone(binding))
  }
  return mapped
}

function experimentError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function committedProposal(record, proposalId) {
  return record?.timelines.find((timeline) => timeline.causality?.proposal.proposalId === proposalId)?.causality ?? null
}

function reviewExperiment({ proposalInput, context, universeId, spec, record, snapshot }) {
  const proposal = validateWorldExperimentProposal(proposalInput)
  if (proposal.universeId !== universeId || context.universeId !== universeId) {
    throw experimentError("experiment_universe_mismatch", "experiment proposal belongs to another universe")
  }
  if (proposal.sourceTimelineId !== context.timelineId
    || proposal.sourceTimelineId !== snapshot.activeTimelineId
    || proposal.sourceTick !== snapshot.state.tick
    || proposal.sourceHistoryHash !== snapshot.state.historyHash) {
    throw experimentError("experiment_source_mismatch", "experiment proposal does not match the active authority source")
  }
  if (proposal.expectedRevision !== snapshot.revision) {
    throw experimentError("experiment_revision_mismatch", "experiment proposal revision is stale")
  }
  if (proposal.requestedBy.type === "player" && proposal.requestedBy.id !== context.actorId) {
    throw experimentError("experiment_identity_mismatch", "player proposal requester does not match the bound actor")
  }
  if (record.timelines.some((timeline) => timeline.timelineId === proposal.newTimelineId)) {
    throw experimentError("timeline_conflict", `timeline ${proposal.newTimelineId} already exists`)
  }
  if (committedProposal(record, proposal.proposalId)) {
    throw experimentError("experiment_replay", `proposal ${proposal.proposalId} was already committed`)
  }
  return { proposal, patch: compileCivilizationRulePatch(spec, proposal) }
}

export function createCivilizationAdapter({
  id = "civilization-engine-alpha",
  source = "esip://evolution/civilization-alpha",
  platform = "evolution-sandbox",
  controllerChanged,
  runtime,
  experimentBindings = [],
  } = {}) {
  if (controllerChanged !== undefined && typeof controllerChanged !== "function") {
    throw new TypeError("controllerChanged must be a function")
  }
  if (runtime !== undefined) {
    for (const method of ["initialize", "create", "execute", "snapshot"]) {
      if (typeof runtime[method] !== "function") throw new TypeError(`runtime.${method} must be a function`)
    }
    if (controllerChanged !== undefined) {
      throw new TypeError("runtime and controllerChanged are mutually exclusive persistence authorities")
    }
  }
  const persistController = controllerChanged ?? (async () => {})
  const experimentIdentities = normalizeExperimentBindings(experimentBindings)
  let controller
  let civilizationSpec
  let universeId

  async function emitError(message, emit, error) {
    await emit(TYPES.ERROR, "result", {
      respondingTo: message.id,
      code: error.code ?? "civilization_error",
      message: error.message,
      retryable: new Set(["revision_conflict", "pulse_in_flight"]).has(error.code),
    }, responseOptions(message))
  }

  const adapter = new EsipAdapter({
    id,
    source,
    platform,
    consumes: [
      TYPES.CIVILIZATION_CREATE_REQUESTED,
      TYPES.CIVILIZATION_COMMAND_REQUESTED,
      TYPES.CIVILIZATION_SNAPSHOT_REQUESTED,
      TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED,
      TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED,
    ],
    produces: [
      TYPES.CIVILIZATION_CREATED,
      TYPES.CIVILIZATION_UPDATED,
      TYPES.CIVILIZATION_SNAPSHOT,
      TYPES.CIVILIZATION_EXPERIMENT_REVIEWED,
      TYPES.CIVILIZATION_EXPERIMENT_COMMITTED,
      TYPES.ERROR,
    ],
    handle: async (message, { emit }) => {
      const response = responseOptions(message)
      try {
        if (runtime) await runtime.initialize()
        if (EXPERIMENT_REQUEST_TYPES.has(message.type)) {
          const identity = experimentIdentities.get(message.source)
          if (!identity) {
            throw experimentError("experiment_source_forbidden", "message source is not authorized for civilization experiments")
          }
          if (message.data.context.actorId !== identity.actorId
            || message.data.context.universeId !== identity.universeId
            || message.subject !== `actor/${identity.actorId}`) {
            throw experimentError(
              "experiment_identity_mismatch",
              "source, actor, universe or subject does not match the experiment identity binding",
            )
          }
        }
        if (message.type === TYPES.CIVILIZATION_CREATE_REQUESTED) {
          if (runtime?.controllerRecord ?? controller) {
            const error = new Error("this adapter already hosts a civilization")
            error.code = "civilization_exists"
            throw error
          }
          if (runtime) {
            const created = await runtime.create({
              spec: message.data.spec,
              universeId: message.data.context.universeId,
              timelineId: message.data.context.timelineId,
              snapshotInterval: message.data.snapshotInterval,
            })
            const snapshot = created.snapshot
            await emit(TYPES.CIVILIZATION_CREATED, "event", {
              context: { ...message.data.context, timelineId: snapshot.activeTimelineId, realmId: snapshot.state.era },
              commandId: message.id,
              snapshot,
            }, { ...response, tick: snapshot.state.tick })
            return
          }
          const candidate = new CivilizationController(message.data.spec, {
            timelineId: message.data.context.timelineId,
            snapshotInterval: message.data.snapshotInterval,
          })
          await persistController(candidate.exportRecord(), candidate.snapshot())
          controller = candidate
          civilizationSpec = structuredClone(message.data.spec)
          universeId = message.data.context.universeId
          const snapshot = candidate.snapshot()
          await emit(TYPES.CIVILIZATION_CREATED, "event", {
            context: { ...message.data.context, timelineId: snapshot.activeTimelineId, realmId: snapshot.state.era },
            commandId: message.id,
            snapshot,
          }, { ...response, tick: snapshot.state.tick })
          return
        }

        if (!(runtime?.controllerRecord ?? controller)) {
          const error = new Error("create a civilization before sending commands or queries")
          error.code = "civilization_not_created"
          throw error
        }
        const boundUniverseId = runtime?.universeId ?? universeId
        if (message.data.context.universeId !== boundUniverseId) {
          const error = new Error(`adapter is bound to universe ${boundUniverseId}`)
          error.code = "universe_conflict"
          throw error
        }
        const currentSnapshot = runtime?.controllerSnapshot ?? controller.snapshot()
        const currentRecord = runtime?.controllerRecord ?? controller.exportRecord()
        const currentSpec = runtime?.civilizationSpec ?? civilizationSpec
        if (EXPERIMENT_REQUEST_TYPES.has(message.type)
          && message.subject !== `actor/${message.data.context.actorId}`) {
          throw experimentError("experiment_identity_mismatch", "experiment subject does not match its actor")
        }

        if (message.type === TYPES.CIVILIZATION_EXPERIMENT_REVIEW_REQUESTED) {
          const reviewed = reviewExperiment({
            proposalInput: message.data.proposal,
            context: message.data.context,
            universeId: boundUniverseId,
            spec: currentSpec,
            record: currentRecord,
            snapshot: currentSnapshot,
          })
          await emit(TYPES.CIVILIZATION_EXPERIMENT_REVIEWED, "result", {
            context: structuredClone(message.data.context),
            respondingTo: message.id,
            status: "pending",
            revision: currentSnapshot.revision,
            proposal: reviewed.proposal,
            patch: reviewed.patch,
          }, { ...response, tick: currentSnapshot.state.tick })
          return
        }

        if (message.type === TYPES.CIVILIZATION_EXPERIMENT_COMMIT_REQUESTED) {
          const proposal = validateWorldExperimentProposal(message.data.proposal)
          const previousCommit = committedProposal(currentRecord, proposal.proposalId)
          if (previousCommit) {
            const patch = compileCivilizationRulePatch(currentSpec, proposal)
            await emit(TYPES.CIVILIZATION_EXPERIMENT_COMMITTED, "event", {
              context: {
                ...message.data.context,
                timelineId: currentSnapshot.activeTimelineId,
                realmId: currentSnapshot.state.era,
              },
              commandId: message.id,
              proposalId: proposal.proposalId,
              patch,
              revision: currentSnapshot.revision,
              snapshot: currentSnapshot,
              duplicate: true,
            }, { ...response, tick: currentSnapshot.state.tick })
            return
          }
          const reviewed = reviewExperiment({
            proposalInput: proposal,
            context: message.data.context,
            universeId: boundUniverseId,
            spec: currentSpec,
            record: currentRecord,
            snapshot: currentSnapshot,
          })
          let snapshot
          if (runtime) {
            const executed = await runtime.execute("commit_experiment", {
              proposal: reviewed.proposal,
              expectedRevision: message.data.expectedRevision,
            })
            snapshot = executed.snapshot
          } else {
            const previousRecord = controller.exportRecord()
            try {
              controller.applyExperiment(reviewed.proposal, { expectedRevision: message.data.expectedRevision })
              await persistController(controller.exportRecord(), controller.snapshot())
            } catch (error) {
              controller = CivilizationController.restore(civilizationSpec, previousRecord)
              throw error
            }
            snapshot = controller.snapshot()
          }
          await emit(TYPES.CIVILIZATION_EXPERIMENT_COMMITTED, "event", {
            context: {
              ...message.data.context,
              timelineId: snapshot.activeTimelineId,
              realmId: snapshot.state.era,
            },
            commandId: message.id,
            proposalId: reviewed.proposal.proposalId,
            patch: reviewed.patch,
            revision: snapshot.revision,
            snapshot,
            duplicate: false,
          }, { ...response, tick: snapshot.state.tick })
          return
        }

        if (message.type === TYPES.CIVILIZATION_SNAPSHOT_REQUESTED) {
          const snapshot = runtime
            ? runtime.snapshot({ recentEvents: message.data.recentEvents })
            : controller.snapshot({ recentEvents: message.data.recentEvents })
          await emit(TYPES.CIVILIZATION_SNAPSHOT, "result", {
            context: { ...message.data.context, timelineId: snapshot.activeTimelineId, realmId: snapshot.state.era },
            respondingTo: message.id,
            revision: snapshot.revision,
            snapshot,
          }, { ...response, tick: snapshot.state.tick })
          return
        }

        const { action, expectedRevision } = message.data
        if (runtime) {
          const executed = await runtime.execute(action, message.data)
          const snapshot = executed.snapshot
          await emit(TYPES.CIVILIZATION_UPDATED, "event", {
            context: { ...message.data.context, timelineId: snapshot.activeTimelineId, realmId: snapshot.state.era },
            commandId: message.id,
            action,
            revision: snapshot.revision,
            snapshot,
            events: executed.result.events ?? [],
          }, { ...response, tick: snapshot.state.tick })
          return
        }
        const previousRecord = controller.exportRecord()
        let result
        try {
          if (action === "advance") result = controller.advance(message.data.ticks, { expectedRevision })
          else if (["pause", "resume", "step", "set_speed"].includes(action)) {
            result = controller.control(action, { expectedRevision, speed: message.data.speed })
          } else if (action === "branch") {
            result = controller.branch(message.data.newTimelineId, {
              expectedRevision,
              fromTimelineId: message.data.fromTimelineId,
              atTick: message.data.atTick,
            })
          } else if (action === "switch_timeline") {
            result = controller.switchTimeline(message.data.targetTimelineId, { expectedRevision })
          }
          await persistController(controller.exportRecord(), controller.snapshot())
        } catch (error) {
          controller = CivilizationController.restore(civilizationSpec, previousRecord)
          throw error
        }
        const snapshot = controller.snapshot()
        await emit(TYPES.CIVILIZATION_UPDATED, "event", {
          context: { ...message.data.context, timelineId: snapshot.activeTimelineId, realmId: snapshot.state.era },
          commandId: message.id,
          action,
          revision: snapshot.revision,
          snapshot,
          events: result.events ?? [],
        }, { ...response, tick: snapshot.state.tick })
      } catch (error) {
        await emitError(message, emit, error)
      }
    },
  })

  Object.defineProperties(adapter, {
    controllerSnapshot: { get: () => runtime?.controllerSnapshot ?? controller?.snapshot() },
    controllerRecord: { get: () => runtime?.controllerRecord ?? controller?.exportRecord() },
    revision: { get: () => runtime?.revision ?? controller?.revision },
  })
  return adapter
}
