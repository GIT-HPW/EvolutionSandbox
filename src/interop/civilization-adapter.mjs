// SPDX-License-Identifier: GPL-3.0-or-later

import { CivilizationController } from "../civilization/controller.mjs"
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

export function createCivilizationAdapter({
  id = "civilization-engine-alpha",
  source = "esip://evolution/civilization-alpha",
  platform = "evolution-sandbox",
  controllerChanged = async () => {},
  } = {}) {
  if (typeof controllerChanged !== "function") throw new TypeError("controllerChanged must be a function")
  let controller
  let civilizationSpec
  let universeId

  async function emitError(message, emit, error) {
    await emit(TYPES.ERROR, "result", {
      respondingTo: message.id,
      code: error.code ?? "civilization_error",
      message: error.message,
      retryable: error.code === "revision_conflict",
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
    ],
    produces: [
      TYPES.CIVILIZATION_CREATED,
      TYPES.CIVILIZATION_UPDATED,
      TYPES.CIVILIZATION_SNAPSHOT,
      TYPES.ERROR,
    ],
    handle: async (message, { emit }) => {
      const response = responseOptions(message)
      try {
        if (message.type === TYPES.CIVILIZATION_CREATE_REQUESTED) {
          if (controller) {
            const error = new Error("this adapter already hosts a civilization")
            error.code = "civilization_exists"
            throw error
          }
          const candidate = new CivilizationController(message.data.spec, {
            timelineId: message.data.context.timelineId,
            snapshotInterval: message.data.snapshotInterval,
          })
          await controllerChanged(candidate.exportRecord(), candidate.snapshot())
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

        if (!controller) {
          const error = new Error("create a civilization before sending commands or queries")
          error.code = "civilization_not_created"
          throw error
        }
        if (message.data.context.universeId !== universeId) {
          const error = new Error(`adapter is bound to universe ${universeId}`)
          error.code = "universe_conflict"
          throw error
        }

        if (message.type === TYPES.CIVILIZATION_SNAPSHOT_REQUESTED) {
          const snapshot = controller.snapshot({ recentEvents: message.data.recentEvents })
          await emit(TYPES.CIVILIZATION_SNAPSHOT, "result", {
            context: { ...message.data.context, timelineId: snapshot.activeTimelineId, realmId: snapshot.state.era },
            respondingTo: message.id,
            revision: snapshot.revision,
            snapshot,
          }, { ...response, tick: snapshot.state.tick })
          return
        }

        const { action, expectedRevision } = message.data
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
          await controllerChanged(controller.exportRecord(), controller.snapshot())
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
    controllerSnapshot: { get: () => controller?.snapshot() },
    controllerRecord: { get: () => controller?.exportRecord() },
    revision: { get: () => controller?.revision },
  })
  return adapter
}
