// SPDX-License-Identifier: GPL-3.0-or-later

import { CivilizationController } from "../civilization/controller.mjs"
import { validateCivilizationSpec } from "../civilization/validation.mjs"
import { buildObservation, metric, recentEvent } from "./builders.mjs"

export function createCivilizationObservation({
  spec,
  record,
  universeId,
  timelineId,
  authority = "civilization-authority",
}) {
  const checkedSpec = validateCivilizationSpec(spec)
  const viewRecord = structuredClone(record)
  if (timelineId !== undefined) viewRecord.activeTimelineId = timelineId
  const controller = CivilizationController.restore(checkedSpec, viewRecord)
  const snapshot = controller.snapshot({ recentEvents: 32 })
  const checkedRecord = controller.exportRecord()
  const timeline = checkedRecord.timelines.find((entry) => entry.timelineId === snapshot.activeTimelineId)
  const causalStatus = timeline.parentTimelineId === null
    ? "baseline"
    : timeline.causality === null ? "unattributed_branch" : "verified_experiment"
  const state = snapshot.state

  return buildObservation({
    universeId,
    timelineId: snapshot.activeTimelineId,
    domain: "civilization",
    tick: state.tick,
    timeScale: snapshot.control.mode === "running" ? snapshot.control.speed : 0,
    revision: snapshot.revision,
    phase: state.era,
    rulePackVersion: String(checkedSpec.schemaVersion),
    summary: {
      title: checkedSpec.name,
      status: state.status === "running" ? snapshot.control.mode : state.status,
      metrics: [
        metric("population", "人口", state.population),
        metric("resources", "资源", state.resources),
        metric("knowledge", "知识", state.knowledge),
        metric("ecology", "生态", state.ecology, "%"),
        metric("cohesion", "凝聚力", state.cohesion, "%"),
        metric("configuredTimeScale", "设定倍率", snapshot.control.speed, "×"),
        metric("causalStatus", "因果状态", causalStatus),
        ...(timeline.causality === null ? [] : [
          metric("experimentIntent", "实验意图", timeline.causality.proposal.intent),
          metric("experimentMagnitude", "实验强度", timeline.causality.proposal.magnitude),
          metric("experimentProposalId", "实验提案", timeline.causality.proposal.proposalId),
        ]),
      ],
    },
    recentEvents: snapshot.recentEvents.map((event, index) => recentEvent(
      "civilization", event, index, state.tick, "文明状态发生变化",
    )),
    capabilities: [
      "world.observe", "simulation.pause", "simulation.resume", "simulation.set_speed",
      "simulation.step", "timeline.branch", "timeline.switch", "timeline.experiment.propose",
    ],
    provenance: {
      authority,
      source: checkedSpec.id,
      adapter: "world-observation.civilization.v0",
      sourceVersion: String(checkedSpec.schemaVersion),
    },
  })
}
