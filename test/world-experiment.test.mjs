// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { CivilizationController } from "../src/civilization/index.mjs"
import {
  compileCivilizationRulePatch,
  createWorldExperimentProposal,
  validateOpenVirFactoryPendingExperiment,
  validateWorldExperimentProposal,
} from "../src/world-experiment/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const spec = JSON.parse(await readFile(
  resolve(root, "content", "civilizations", "presets", "tidal-archive.json"),
  "utf8",
))

const openVirFactoryRequest = {
  schemaVersion: 1,
  goal: "优先修复生态，并观察文明能否保持长期稳定。",
  context: {
    universeId: "universe-1",
    sourceTimelineId: "main",
    sourceTick: 100,
    sourceHistoryHash: "1234abcd",
    expectedRevision: 7,
    allowedIntents: ["research_focus", "ecology_policy"],
  },
  newTimelineId: "ecology-model-trial",
}

const openVirFactoryPending = {
  schemaVersion: 1,
  status: "pending",
  proposal: {
    schemaVersion: 1,
    proposalId: "experiment-d6c4de7a",
    universeId: "universe-1",
    domain: "civilization",
    sourceTimelineId: "main",
    sourceTick: 100,
    sourceHistoryHash: "1234abcd",
    expectedRevision: 7,
    requestedBy: { type: "model", id: "ollama:qwen2.5-coder:7b" },
    intent: "ecology_policy",
    magnitude: 2,
    newTimelineId: "ecology-model-trial",
    title: "生态修复实验",
    rationale: "提高生态优先级并降低扩张倾向，比较同一起点的长期差异。",
  },
  audit: {
    adapter: "open-virfactory.world-experiment.v0",
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    requestHash: "0272815e",
  },
}

function proposalFor(controller, overrides = {}) {
  const snapshot = controller.snapshot()
  return createWorldExperimentProposal({
    universeId: "universe-1",
    sourceTimelineId: snapshot.activeTimelineId,
    sourceTick: snapshot.state.tick,
    sourceHistoryHash: snapshot.state.historyHash,
    expectedRevision: snapshot.revision,
    requestedBy: { type: "player", id: "observer-1" },
    intent: "research_focus",
    magnitude: 2,
    newTimelineId: "research-path",
    title: "知识投入对照",
    rationale: "比较相同历史点在提高知识优先级后的长期差异。",
    ...overrides,
  })
}

test("WorldExperimentProposal is deterministic, strict and bounded by the civilization spec", () => {
  const controller = new CivilizationController(spec, { timelineId: "main" })
  const first = proposalFor(controller)
  const second = proposalFor(controller)
  assert.deepEqual(first, second)
  assert.match(first.proposalId, /^experiment-[0-9a-f]{8}$/)
  assert.deepEqual(compileCivilizationRulePatch(spec, first), {
    knowledge: 16,
    ecology: 0,
    expansion: -4,
    militarism: 0,
    collectivism: 0,
  })

  const changed = structuredClone(first)
  changed.magnitude = 3
  assert.throws(
    () => validateWorldExperimentProposal(changed),
    (error) => error.code === "experiment_hash_mismatch",
  )
  assert.throws(
    () => compileCivilizationRulePatch(spec, proposalFor(controller, { intent: "cohesion_policy" })),
    (error) => error.code === "experiment_intent_forbidden",
  )
})

test("openVirFactory pending envelope matches the same proposal contract without granting execution", () => {
  const checked = validateOpenVirFactoryPendingExperiment(openVirFactoryPending, {
    expectedRequest: openVirFactoryRequest,
    expectedUniverseId: "universe-1",
    expectedTimelineId: "main",
    expectedTick: 100,
    expectedHistoryHash: "1234abcd",
    expectedRevision: 7,
    allowedIntents: spec.autonomy.allowedIntents,
  })
  assert.deepEqual(checked, openVirFactoryPending)

  const replayed = structuredClone(openVirFactoryPending)
  replayed.audit.requestHash = "89abcdef"
  assert.throws(
    () => validateOpenVirFactoryPendingExperiment(replayed, { expectedRequest: openVirFactoryRequest }),
    (error) => error.code === "experiment_request_mismatch",
  )

  assert.throws(
    () => validateOpenVirFactoryPendingExperiment(openVirFactoryPending, { expectedRevision: 8 }),
    (error) => error.code === "experiment_revision_mismatch",
  )
  const forgedAudit = structuredClone(openVirFactoryPending)
  forgedAudit.audit.model = "another-model"
  assert.throws(
    () => validateOpenVirFactoryPendingExperiment(forgedAudit),
    (error) => error.code === "experiment_provenance_mismatch",
  )
})

test("confirmed experiment branches keep an auditable cause and deterministically diverge", () => {
  const controller = new CivilizationController(spec, { timelineId: "main", snapshotInterval: 50 })
  controller.advance(100)
  const proposal = proposalFor(controller)
  const before = controller.exportRecord()
  validateWorldExperimentProposal(proposal)
  assert.deepEqual(controller.exportRecord(), before)

  controller.applyExperiment(proposal, { expectedRevision: 1 })
  let record = controller.exportRecord()
  const experiment = record.timelines.find((timeline) => timeline.timelineId === "research-path")
  assert.equal(experiment.parentTimelineId, "main")
  assert.equal(experiment.causality.proposal.proposalId, proposal.proposalId)
  assert.equal(experiment.causality.committedRevision, 2)
  assert.equal(experiment.events[0].type, "world_experiment_committed")

  controller.advance(100, { expectedRevision: 2 })
  const experimentState = controller.snapshot().state
  controller.switchTimeline("main", { expectedRevision: 3 })
  controller.advance(100, { expectedRevision: 4 })
  const baselineState = controller.snapshot().state
  assert.equal(experimentState.tick, baselineState.tick)
  assert.notEqual(experimentState.knowledge, baselineState.knowledge)
  assert.notEqual(experimentState.historyHash, baselineState.historyHash)

  record = controller.exportRecord()
  assert.deepEqual(CivilizationController.restore(spec, record).exportRecord(), record)
  const altered = structuredClone(record)
  altered.timelines.find((timeline) => timeline.timelineId === "research-path").causality.patch.knowledge += 1
  assert.throws(
    () => CivilizationController.restore(spec, altered),
    (error) => error.code === "experiment_patch_mismatch",
  )
})

test("stale proposals fail closed and legacy records migrate without inventing causality", () => {
  const running = new CivilizationController(spec)
  const runningProposal = proposalFor(running, { newTimelineId: "running-trial" })
  running.control("resume", { expectedRevision: 0 })
  assert.throws(
    () => running.applyExperiment(runningProposal, { expectedRevision: 1 }),
    (error) => error.code === "experiment_requires_pause",
  )

  const controller = new CivilizationController(spec, { timelineId: "main" })
  const proposal = proposalFor(controller)
  controller.control("set_speed", { speed: 4, expectedRevision: 0 })
  assert.throws(
    () => controller.applyExperiment(proposal, { expectedRevision: 1 }),
    (error) => error.code === "experiment_revision_mismatch",
  )
  assert.equal(controller.exportRecord().timelines.length, 1)

  const current = new CivilizationController(spec, { timelineId: "legacy-main" }).exportRecord()
  const legacy = structuredClone(current)
  legacy.schemaVersion = 1
  for (const timeline of legacy.timelines) {
    delete timeline.policy
    delete timeline.causality
  }
  const migrated = CivilizationController.restore(spec, legacy).exportRecord()
  assert.equal(migrated.schemaVersion, 2)
  assert.equal(migrated.timelines[0].causality, null)
  assert.deepEqual(migrated.timelines[0].policy, {
    knowledge: 0,
    ecology: 0,
    expansion: 0,
    militarism: 0,
    collectivism: 0,
  })
})
