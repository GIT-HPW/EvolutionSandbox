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
  TIMELINE_CREATE_REQUESTED: "io.evolution.timeline.create.requested.v1",
  TIMELINE_CREATED: "io.evolution.timeline.created.v1",
  TIMELINE_CREATED_V2: "io.evolution.timeline.created.v2",
  TIMELINE_JOIN_REQUESTED: "io.evolution.timeline.join.requested.v1",
  TIMELINE_JOINED: "io.evolution.timeline.joined.v1",
  TIMELINE_REGISTRY_REQUESTED: "io.evolution.timeline.registry.requested.v1",
  TIMELINE_REGISTRY_SNAPSHOT: "io.evolution.timeline.registry.snapshot.v1",
  CIVILIZATION_CREATE_REQUESTED: "io.evolution.civilization.create.requested.v1",
  CIVILIZATION_CREATED: "io.evolution.civilization.created.v1",
  CIVILIZATION_COMMAND_REQUESTED: "io.evolution.civilization.command.requested.v1",
  CIVILIZATION_UPDATED: "io.evolution.civilization.updated.v1",
  CIVILIZATION_SNAPSHOT_REQUESTED: "io.evolution.civilization.snapshot.requested.v1",
  CIVILIZATION_SNAPSHOT: "io.evolution.civilization.snapshot.v1",
  ERROR: "io.evolution.error.v1",
})

export const MESSAGE_DEFINITIONS = Object.freeze({
  [TYPES.CAPABILITY_HELLO]: { kind: "event", schema: "capability-hello-v1.schema.json" },
  [TYPES.ACTION_REQUESTED]: { kind: "command", schema: "action-requested-v1.schema.json" },
  [TYPES.ACTION_APPLIED]: { kind: "event", schema: "action-applied-v1.schema.json" },
  [TYPES.STATE_REQUESTED]: { kind: "query", schema: "state-requested-v1.schema.json" },
  [TYPES.STATE_SNAPSHOT]: { kind: "result", schema: "state-snapshot-v1.schema.json" },
  [TYPES.REALM_TRANSITIONED]: { kind: "event", schema: "realm-transitioned-v1.schema.json" },
  [TYPES.TIMELINE_CREATE_REQUESTED]: { kind: "command", schema: "timeline-create-requested-v1.schema.json" },
  [TYPES.TIMELINE_CREATED]: { kind: "event", schema: "timeline-created-v1.schema.json" },
  [TYPES.TIMELINE_CREATED_V2]: { kind: "event", schema: "timeline-created-v2.schema.json" },
  [TYPES.TIMELINE_JOIN_REQUESTED]: { kind: "command", schema: "timeline-join-requested-v1.schema.json" },
  [TYPES.TIMELINE_JOINED]: { kind: "event", schema: "timeline-joined-v1.schema.json" },
  [TYPES.TIMELINE_REGISTRY_REQUESTED]: { kind: "query", schema: "timeline-registry-requested-v1.schema.json" },
  [TYPES.TIMELINE_REGISTRY_SNAPSHOT]: { kind: "result", schema: "timeline-registry-snapshot-v1.schema.json" },
  [TYPES.CIVILIZATION_CREATE_REQUESTED]: { kind: "command", schema: "civilization-create-requested-v1.schema.json" },
  [TYPES.CIVILIZATION_CREATED]: { kind: "event", schema: "civilization-created-v1.schema.json" },
  [TYPES.CIVILIZATION_COMMAND_REQUESTED]: { kind: "command", schema: "civilization-command-requested-v1.schema.json" },
  [TYPES.CIVILIZATION_UPDATED]: { kind: "event", schema: "civilization-updated-v1.schema.json" },
  [TYPES.CIVILIZATION_SNAPSHOT_REQUESTED]: { kind: "query", schema: "civilization-snapshot-requested-v1.schema.json" },
  [TYPES.CIVILIZATION_SNAPSHOT]: { kind: "result", schema: "civilization-snapshot-v1.schema.json" },
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
