// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { CivilizationObservatory } from "../src/civilization-observatory.mjs"
import {
  createWorldExperimentProposal,
  openVirFactoryExperimentRequestHash,
} from "../../../src/world-experiment/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const spec = JSON.parse(await readFile(resolve(root, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"))

test("civilization observatory renders only validated WorldObservation snapshots", () => {
  const observatory = new CivilizationObservatory(spec, { universeId: "observatory-test" })
  const before = observatory.exportRecord()
  const observation = observatory.observe()

  assert.equal(observation.domain, "civilization")
  assert.equal(observation.timelineId, "origin")
  assert.equal(observation.timeScale, 0)
  assert.equal(observation.summary.status, "paused")
  assert.ok(observation.summary.metrics.some((metric) => metric.id === "population"))
  assert.deepEqual(observatory.exportRecord(), before)
})

test("time controls update authority first and then expose confirmed observations", () => {
  const observatory = new CivilizationObservatory(spec)
  observatory.control("set_speed", { speed: 4 })
  const running = observatory.control("resume").observation
  assert.equal(running.timeScale, 4)
  assert.equal(running.summary.status, "running")

  const advanced = observatory.pulse().observation
  assert.equal(advanced.tick, 4)
  const paused = observatory.control("pause").observation
  assert.equal(paused.timeScale, 0)
  assert.equal(paused.summary.metrics.find((metric) => metric.id === "configuredTimeScale").value, 4)
})

test("timeline list and comparison never switch or rewrite the active authority timeline", () => {
  const observatory = new CivilizationObservatory(spec, { timelineId: "main", snapshotInterval: 50 })
  observatory.advance(120)
  observatory.branch("archive-path", { atTick: 60, fromTimelineId: "main" })
  observatory.advance(20)
  const before = observatory.exportRecord()

  const timelines = observatory.list().map((entry) => entry.observation)
  assert.deepEqual(timelines.map((entry) => entry.timelineId).sort(), ["archive-path", "main"])
  const comparison = observatory.compare("main", "archive-path")
  assert.equal(comparison.sameUniverse, true)
  assert.equal(comparison.tickDelta, -40)
  assert.ok(comparison.metricChanges.some((entry) => entry.id === "population"))
  assert.deepEqual(observatory.exportRecord(), before)

  const restored = new CivilizationObservatory(spec, { record: observatory.exportRecord() })
  assert.deepEqual(restored.observe(), observatory.observe())
})

test("experiment proposals require a second commit and expose verified causality through observation", () => {
  const observatory = new CivilizationObservatory(spec, { timelineId: "main", snapshotInterval: 50 })
  observatory.advance(100)
  assert.ok(observatory.experimentOptions().some((entry) => entry.id === "ecology_policy"))

  const before = observatory.exportRecord()
  const staged = observatory.proposeExperiment({
    intent: "ecology_policy",
    magnitude: 2,
    newTimelineId: "ecology-trial",
    title: "生态修复对照",
    rationale: "观察更高生态优先级对同一起点长期演化的影响。",
  })
  assert.equal(staged.patch.ecology, 16)
  assert.deepEqual(observatory.exportRecord(), before)

  const committed = observatory.commitExperiment(staged.proposal)
  const metrics = new Map(committed.observation.summary.metrics.map((entry) => [entry.id, entry.value]))
  assert.equal(committed.observation.timelineId, "ecology-trial")
  assert.equal(metrics.get("causalStatus"), "verified_experiment")
  assert.equal(metrics.get("experimentIntent"), "ecology_policy")
  assert.equal(metrics.get("experimentProposalId"), staged.proposal.proposalId)

  const restored = new CivilizationObservatory(spec, { record: observatory.exportRecord() })
  assert.deepEqual(restored.observe(), observatory.observe())
})

test("experiment commit rejects a proposal after authority revision changes", () => {
  const observatory = new CivilizationObservatory(spec)
  const staged = observatory.proposeExperiment({
    intent: "research_focus",
    magnitude: 1,
    newTimelineId: "stale-trial",
    title: "知识实验",
    rationale: "验证过期提案不会建立分支。",
  })
  observatory.control("set_speed", { speed: 4 })
  assert.throws(
    () => observatory.commitExperiment(staged.proposal),
    (error) => error.code === "experiment_revision_mismatch",
  )
  assert.equal(observatory.exportRecord().timelines.length, 1)
})

test("openVirFactory result stays pending until the observatory reviews and commits it", () => {
  const observatory = new CivilizationObservatory(spec, { timelineId: "main" })
  observatory.advance(40)
  assert.throws(
    () => observatory.experimentRequest("优先修复生态", "invalid target"),
    (error) => error.code === "invalid_experiment",
  )
  const request = observatory.experimentRequest("优先修复生态", "model-ecology-trial")
  const proposal = createWorldExperimentProposal({
    universeId: request.context.universeId,
    sourceTimelineId: request.context.sourceTimelineId,
    sourceTick: request.context.sourceTick,
    sourceHistoryHash: request.context.sourceHistoryHash,
    expectedRevision: request.context.expectedRevision,
    requestedBy: { type: "model", id: "ollama:qwen2.5-coder:7b" },
    intent: "ecology_policy",
    magnitude: 2,
    newTimelineId: request.newTimelineId,
    title: "生态修复实验",
    rationale: "提高生态优先级并降低扩张倾向。",
  })
  const pending = {
    schemaVersion: 1,
    status: "pending",
    proposal,
    audit: {
      adapter: "open-virfactory.world-experiment.v0",
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      requestHash: openVirFactoryExperimentRequestHash(request),
    },
  }
  const before = observatory.exportRecord()
  assert.throws(
    () => observatory.reviewExternalExperiment(pending),
    (error) => error.code === "experiment_request_required",
  )
  const reviewed = observatory.reviewExternalExperiment(pending, request)
  assert.equal(reviewed.patch.ecology, 16)
  assert.deepEqual(observatory.exportRecord(), before)

  const committed = observatory.commitExperiment(reviewed.proposal)
  assert.equal(committed.observation.timelineId, "model-ecology-trial")
})
