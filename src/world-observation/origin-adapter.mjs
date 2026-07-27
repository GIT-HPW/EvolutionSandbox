// SPDX-License-Identifier: GPL-3.0-or-later

import { validatePack } from "../rules-engine.mjs"
import { buildObservation, metric, recentEvent } from "./builders.mjs"

export function createOriginObservation({
  pack,
  state,
  revision,
  universeId,
  authority = "origin-authority",
  recentEvents = [],
}) {
  const checkedPack = validatePack(pack)
  const phase = checkedPack.phases.find((candidate) => candidate.id === state?.phase)
  if (!phase) throw new TypeError("origin state references an unknown phase")
  const events = recentEvents.slice(-32).map((event, index) => recentEvent(
    "origin", event, index, state.steps, "原点状态发生变化",
  ))
  const actionCapabilities = Object.entries(checkedPack.actions)
    .filter(([, action]) => action.availableIn.includes(state.phase))
    .map(([actionId]) => `origin.action.${actionId}`)

  return buildObservation({
    universeId,
    timelineId: state.timeline,
    domain: "origin",
    tick: state.steps,
    timeScale: 0,
    revision,
    phase: state.phase,
    rulePackVersion: checkedPack.version,
    summary: {
      title: checkedPack.title,
      status: phase.title,
      metrics: [
        metric("dimension", "维度", state.dimension),
        metric("energy", "能量", state.energy),
        metric("information", "信息", state.information),
        metric("entropy", "熵", state.entropy),
        metric("stability", "稳定度", state.stability, "%"),
        metric("fragments", "碎片", state.fragments),
        metric("matter", "物质", state.matter ?? 0),
      ],
    },
    recentEvents: events,
    capabilities: ["world.observe", ...actionCapabilities],
    provenance: {
      authority,
      source: checkedPack.id,
      adapter: "world-observation.origin.v0",
      sourceVersion: checkedPack.version,
    },
  })
}
