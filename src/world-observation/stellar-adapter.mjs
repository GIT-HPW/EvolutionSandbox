// SPDX-License-Identifier: GPL-3.0-or-later

import { validateStellarControllerRecord } from "../stellar/controller.mjs"
import { validateStellarSpec } from "../stellar/validation.mjs"
import { buildObservation, metric, recentEvent } from "./builders.mjs"

export function createStellarObservation({
  spec,
  record,
  universeId,
  timelineId = "origin",
  authority = "stellar-authority",
  recentEvents,
}) {
  const checkedSpec = validateStellarSpec(spec)
  const checked = validateStellarControllerRecord(checkedSpec, record)
  const state = checked.state
  const rawEvents = recentEvents ?? state.milestones.map((milestone) => ({
    tick: milestone.tick,
    type: "stellar_milestone",
    title: milestone.id,
  }))

  return buildObservation({
    universeId,
    timelineId,
    domain: "stellar",
    tick: state.tick,
    timeScale: checked.control.mode === "running" ? checked.control.speed : 0,
    revision: checked.revision,
    phase: state.phase,
    rulePackVersion: String(checkedSpec.schemaVersion),
    summary: {
      title: checkedSpec.name,
      status: state.status,
      metrics: [
        metric("stellarMass", "星体质量", state.stellarMass, "M☉"),
        metric("temperature", "核心温度", state.temperature, "MK"),
        metric("luminosity", "光度", state.luminosity, "万 L☉"),
        metric("stability", "动态稳定度", state.stability, "%"),
        metric("fuel", "可用燃料", state.fuel, "%"),
        metric("elementDiversity", "复杂物质", state.elementDiversity, "级"),
        metric("diskStability", "行星盘结构度", state.diskStability, "%"),
      ],
    },
    recentEvents: rawEvents.slice(-32).map((event, index) => recentEvent(
      "stellar", event, index, state.tick, "恒星状态发生变化",
    )),
    capabilities: [
      "world.observe", "simulation.pause", "simulation.resume",
      "simulation.set_speed", "simulation.step",
    ],
    provenance: {
      authority,
      source: checkedSpec.id,
      adapter: "world-observation.stellar.v0",
      sourceVersion: String(checkedSpec.schemaVersion),
    },
  })
}
