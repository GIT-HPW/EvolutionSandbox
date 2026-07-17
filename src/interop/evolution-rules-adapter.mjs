// SPDX-License-Identifier: GPL-3.0-or-later

import { applyAction, createState } from "../rules-engine.mjs"
import { EsipAdapter } from "./adapter.mjs"
import { TYPES } from "./message-types.mjs"

export function createEvolutionRulesAdapter({
  pack,
  id = "luanti-world-alpha",
  source = "esip://luanti/world-alpha",
  platform = "luanti",
} = {}) {
  let state = createState(pack)
  let revision = 0

  const adapter = new EsipAdapter({
    id,
    source,
    platform,
    consumes: [TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED],
    produces: [TYPES.ACTION_APPLIED, TYPES.STATE_SNAPSHOT, TYPES.REALM_TRANSITIONED, TYPES.ERROR],
    handle: async (message, { emit }) => {
      const response = {
        subject: message.subject,
        target: message.source,
        correlationid: message.correlationid ?? message.id,
        causationid: message.id,
      }
      if (message.type === TYPES.STATE_REQUESTED) {
        await emit(TYPES.STATE_SNAPSHOT, "result", {
          context: { ...message.data.context, realmId: state.phase },
          respondingTo: message.id,
          revision,
          state,
        }, response)
        return
      }

      if (message.data.expectedRevision !== undefined && message.data.expectedRevision !== revision) {
        await emit(TYPES.ERROR, "result", {
          respondingTo: message.id,
          code: "revision_conflict",
          message: `expected revision ${message.data.expectedRevision}, current revision is ${revision}`,
          retryable: true,
        }, response)
        return
      }

      const previous = state
      try {
        const result = applyAction(pack, state, message.data.actionId)
        state = result.state
        revision += 1
        const context = { ...message.data.context, realmId: state.phase, timelineId: state.timeline }
        await emit(TYPES.ACTION_APPLIED, "event", {
          context,
          commandId: message.id,
          actionId: message.data.actionId,
          outcome: "applied",
          revision,
          state,
        }, response)
        if (result.event.transitioned) {
          await emit(TYPES.REALM_TRANSITIONED, "event", {
            context,
            fromRealm: result.event.fromPhase,
            toRealm: result.event.toPhase,
            fromDimension: previous.dimension,
            toDimension: state.dimension,
            revision,
          }, response)
        }
      } catch (error) {
        await emit(TYPES.ERROR, "result", {
          respondingTo: message.id,
          code: error.code ?? "rule_error",
          message: error.message,
          retryable: false,
        }, response)
      }
    },
  })

  Object.defineProperties(adapter, {
    stateSnapshot: { get: () => structuredClone(state) },
    revision: { get: () => revision },
  })
  return adapter
}
