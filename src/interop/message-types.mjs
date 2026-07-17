// SPDX-License-Identifier: GPL-3.0-or-later

export const ESIP_VERSION = "0.1"
export const CLOUD_EVENTS_VERSION = "1.0"

export const TYPES = Object.freeze({
  CAPABILITY_HELLO: "io.evolution.capability.hello.v1",
  ACTION_REQUESTED: "io.evolution.action.requested.v1",
  ACTION_APPLIED: "io.evolution.action.applied.v1",
  STATE_REQUESTED: "io.evolution.state.requested.v1",
  STATE_SNAPSHOT: "io.evolution.state.snapshot.v1",
  REALM_TRANSITIONED: "io.evolution.realm.transitioned.v1",
  TIMELINE_CREATED: "io.evolution.timeline.created.v1",
  ERROR: "io.evolution.error.v1",
})

export const MESSAGE_DEFINITIONS = Object.freeze({
  [TYPES.CAPABILITY_HELLO]: { kind: "event", schema: "capability-hello-v1.schema.json" },
  [TYPES.ACTION_REQUESTED]: { kind: "command", schema: "action-requested-v1.schema.json" },
  [TYPES.ACTION_APPLIED]: { kind: "event", schema: "action-applied-v1.schema.json" },
  [TYPES.STATE_REQUESTED]: { kind: "query", schema: "state-requested-v1.schema.json" },
  [TYPES.STATE_SNAPSHOT]: { kind: "result", schema: "state-snapshot-v1.schema.json" },
  [TYPES.REALM_TRANSITIONED]: { kind: "event", schema: "realm-transitioned-v1.schema.json" },
  [TYPES.TIMELINE_CREATED]: { kind: "event", schema: "timeline-created-v1.schema.json" },
  [TYPES.ERROR]: { kind: "result", schema: "error-v1.schema.json" },
})

export const KINDS = Object.freeze(["command", "event", "query", "result"])
export const SCHEMA_BASE_URL = "https://git-hpw.github.io/EvolutionSandbox/esip/schemas/"

export function schemaUrlFor(type) {
  const definition = MESSAGE_DEFINITIONS[type]
  return definition ? SCHEMA_BASE_URL + definition.schema : undefined
}

export function typeMatches(pattern, type) {
  if (pattern === type || pattern === "*") return true
  return pattern.endsWith(".*") && type.startsWith(pattern.slice(0, -1))
}
