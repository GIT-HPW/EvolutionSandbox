// SPDX-License-Identifier: GPL-3.0-or-later

import { CivilizationController } from "../../../src/civilization/controller.mjs"
import { validateCivilizationSpec } from "../../../src/civilization/validation.mjs"
import {
  createCivilizationObservation,
  WorldObservationRegistry,
} from "../../../src/world-observation/index.mjs"
import {
  compileCivilizationRulePatch,
  createWorldExperimentProposal,
  listCivilizationExperimentIntents,
  validateOpenVirFactoryExperimentRequest,
  validateOpenVirFactoryPendingExperiment,
  validateWorldExperimentProposal,
  WorldExperimentError,
} from "../../../src/world-experiment/index.mjs"

export class CivilizationObservatory {
  constructor(input, {
    record,
    universeId = "universe-1",
    timelineId = "origin",
    snapshotInterval = 100,
  } = {}) {
    this._spec = validateCivilizationSpec(input)
    this._universeId = universeId
    this._controller = record === undefined
      ? new CivilizationController(this._spec, { timelineId, snapshotInterval })
      : CivilizationController.restore(this._spec, record)
  }

  _record() {
    return this._controller.exportRecord()
  }

  _registry(record = this._record()) {
    const registry = new WorldObservationRegistry()
    for (const timeline of record.timelines) {
      registry.register(`civilization:${timeline.timelineId}`, {
        domain: "civilization",
        universeId: this._universeId,
        source: this._spec.id,
        observe: () => createCivilizationObservation({
          spec: this._spec,
          record,
          universeId: this._universeId,
          timelineId: timeline.timelineId,
        }),
      })
    }
    return registry
  }

  observe(timelineId = this._record().activeTimelineId) {
    return createCivilizationObservation({
      spec: this._spec,
      record: this._record(),
      universeId: this._universeId,
      timelineId,
    })
  }

  list() {
    return this._registry().list()
  }

  compare(leftTimelineId, rightTimelineId) {
    return this._registry().compare(
      `civilization:${leftTimelineId}`,
      `civilization:${rightTimelineId}`,
    )
  }

  experimentOptions() {
    return listCivilizationExperimentIntents(this._spec)
  }

  experimentRequest(goal, newTimelineId) {
    if (typeof goal !== "string" || goal.trim().length < 1 || goal.length > 512) {
      throw new WorldExperimentError("invalid_experiment", "experiment goal must contain 1-512 characters")
    }
    const record = this._record()
    const source = record.timelines.find((timeline) => timeline.timelineId === record.activeTimelineId)
    return validateOpenVirFactoryExperimentRequest({
      schemaVersion: 1,
      goal: goal.trim(),
      context: {
        universeId: this._universeId,
        sourceTimelineId: source.timelineId,
        sourceTick: source.state.tick,
        sourceHistoryHash: source.state.historyHash,
        expectedRevision: record.revision,
        allowedIntents: this._spec.autonomy.allowedIntents.slice(),
      },
      newTimelineId,
    })
  }

  reviewExternalExperiment(pendingInput, requestInput) {
    if (requestInput === undefined) {
      throw new WorldExperimentError(
        "experiment_request_required",
        "the originating openVirFactory experiment request is required for review",
      )
    }
    const record = this._record()
    const source = record.timelines.find((timeline) => timeline.timelineId === record.activeTimelineId)
    const pending = validateOpenVirFactoryPendingExperiment(pendingInput, {
      expectedRequest: requestInput,
      expectedUniverseId: this._universeId,
      expectedTimelineId: source.timelineId,
      expectedTick: source.state.tick,
      expectedHistoryHash: source.state.historyHash,
      expectedRevision: record.revision,
      allowedIntents: this._spec.autonomy.allowedIntents,
    })
    return {
      proposal: pending.proposal,
      patch: compileCivilizationRulePatch(this._spec, pending.proposal),
      audit: pending.audit,
    }
  }

  proposeExperiment({
    intent,
    magnitude,
    newTimelineId,
    requestedBy = { type: "player", id: "local-observer" },
    title,
    rationale,
  }) {
    const record = this._record()
    const source = record.timelines.find((timeline) => timeline.timelineId === record.activeTimelineId)
    const proposal = createWorldExperimentProposal({
      universeId: this._universeId,
      sourceTimelineId: source.timelineId,
      sourceTick: source.state.tick,
      sourceHistoryHash: source.state.historyHash,
      expectedRevision: record.revision,
      requestedBy,
      intent,
      magnitude,
      newTimelineId,
      title,
      rationale,
    })
    return { proposal, patch: compileCivilizationRulePatch(this._spec, proposal) }
  }

  commitExperiment(proposalInput) {
    const proposal = validateWorldExperimentProposal(proposalInput)
    if (proposal.universeId !== this._universeId) {
      throw new WorldExperimentError(
        "experiment_universe_mismatch",
        `proposal belongs to universe ${proposal.universeId}`,
      )
    }
    return this._apply((expectedRevision) => this._controller.applyExperiment(proposal, { expectedRevision }))
  }

  _apply(operation) {
    const result = operation(this._controller.revision)
    return { result, observation: this.observe() }
  }

  control(action, { speed } = {}) {
    return this._apply((expectedRevision) => this._controller.control(action, { expectedRevision, speed }))
  }

  advance(ticks) {
    return this._apply((expectedRevision) => this._controller.advance(ticks, { expectedRevision }))
  }

  pulse() {
    return this._apply((expectedRevision) => this._controller.pulse({ expectedRevision }))
  }

  branch(newTimelineId, { atTick, fromTimelineId } = {}) {
    return this._apply((expectedRevision) => this._controller.branch(newTimelineId, {
      atTick,
      fromTimelineId,
      expectedRevision,
    }))
  }

  switchTimeline(timelineId) {
    return this._apply((expectedRevision) => this._controller.switchTimeline(timelineId, { expectedRevision }))
  }

  exportRecord() {
    return this._record()
  }
}
