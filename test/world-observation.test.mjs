// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { CivilizationController } from "../src/civilization/index.mjs"
import { loadOriginPack } from "../src/load-pack.mjs"
import { applyAction, createState } from "../src/rules-engine.mjs"
import { StellarController } from "../src/stellar/index.mjs"
import {
  createCivilizationObservation,
  createOriginObservation,
  createStellarObservation,
  validateWorldObservation,
  WorldObservationRegistry,
} from "../src/world-observation/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const originPack = await loadOriginPack()
const stellarSpec = JSON.parse(await readFile(resolve(root, "content", "stellar", "presets", "first-light.json"), "utf8"))
const civilizationSpec = JSON.parse(await readFile(resolve(root, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"))
const universeId = "universe-observation-test"

function fixtures() {
  let originState = createState(originPack)
  const originEvents = []
  for (const action of ["observe", "split"]) {
    const result = applyAction(originPack, originState, action)
    originState = result.state
    originEvents.push({ ...result.event, tick: originState.steps })
  }

  const stellar = new StellarController(stellarSpec)
  stellar.advance(40)
  const civilization = new CivilizationController(civilizationSpec, { timelineId: "origin", snapshotInterval: 50 })
  civilization.advance(120)

  return {
    originState,
    originEvents,
    stellar,
    civilization,
    observations: {
      origin: () => createOriginObservation({
        pack: originPack,
        state: originState,
        revision: 2,
        universeId,
        recentEvents: originEvents,
      }),
      stellar: () => createStellarObservation({
        spec: stellarSpec,
        record: stellar.exportRecord(),
        universeId,
      }),
      civilization: () => createCivilizationObservation({
        spec: civilizationSpec,
        record: civilization.exportRecord(),
        universeId,
      }),
    },
  }
}

test("origin, stellar and civilization expose the same strict observation shell", () => {
  const { observations } = fixtures()
  const origin = observations.origin()
  const stellar = observations.stellar()
  const civilization = observations.civilization()

  assert.deepEqual([origin.domain, stellar.domain, civilization.domain], ["origin", "stellar", "civilization"])
  for (const observation of [origin, stellar, civilization]) {
    assert.equal(validateWorldObservation(observation).schemaVersion, 1)
    assert.equal(observation.universeId, universeId)
    assert.ok(observation.rulePackVersion)
    assert.ok(observation.summary.metrics.length > 0)
    assert.ok(observation.capabilities.includes("world.observe"))
  }
  assert.equal(origin.tick, 2)
  assert.equal(stellar.tick, 40)
  assert.equal(civilization.tick, 120)
  assert.equal(civilization.timelineId, "origin")
})

test("observation validation rejects unknown fields, missing versions and unknown provenance", () => {
  const observation = fixtures().observations.origin()
  assert.throws(
    () => validateWorldObservation({ ...observation, unexpected: true }),
    (error) => error.code === "invalid_observation" && error.message.includes("unexpected"),
  )

  const missingVersion = structuredClone(observation)
  delete missingVersion.rulePackVersion
  assert.throws(() => validateWorldObservation(missingVersion), (error) => error.code === "invalid_observation")

  const nestedUnknown = structuredClone(observation)
  nestedUnknown.provenance.unexpected = true
  assert.throws(() => validateWorldObservation(nestedUnknown), (error) => error.code === "invalid_observation")

  assert.throws(
    () => validateWorldObservation(observation, { allowedSources: ["another.source"] }),
    (error) => error.code === "unknown_provenance",
  )
})

test("one read-only registry lists, queries and compares all three domains", () => {
  const fixture = fixtures()
  const stellarBefore = fixture.stellar.exportRecord()
  const civilizationBefore = fixture.civilization.exportRecord()
  const originBefore = structuredClone(fixture.originState)
  const registry = new WorldObservationRegistry()
    .register("origin-main", {
      domain: "origin", universeId, source: originPack.id, observe: fixture.observations.origin,
    })
    .register("stellar-main", {
      domain: "stellar", universeId, source: stellarSpec.id, observe: fixture.observations.stellar,
    })
    .register("civilization-main", {
      domain: "civilization", universeId, source: civilizationSpec.id, observe: fixture.observations.civilization,
    })

  assert.deepEqual(registry.list().map((entry) => entry.observation.domain).sort(), ["civilization", "origin", "stellar"])
  assert.equal(registry.get("stellar-main").phase, fixture.stellar.snapshot().state.phase)
  const comparison = registry.compare("origin-main", "civilization-main")
  assert.equal(comparison.sameUniverse, true)
  assert.equal(comparison.sameTimeline, true)
  assert.equal(comparison.tickDelta, 118)
  assert.ok(comparison.metricChanges.some((entry) => entry.id === "population" && entry.left === null))

  assert.deepEqual(fixture.originState, originBefore)
  assert.deepEqual(fixture.stellar.exportRecord(), stellarBefore)
  assert.deepEqual(fixture.civilization.exportRecord(), civilizationBefore)
})

test("registry refuses a provider that changes its declared domain or source", () => {
  const observation = fixtures().observations.origin()
  const wrongDomain = new WorldObservationRegistry().register("bad-domain", {
    domain: "stellar", universeId, source: originPack.id, observe: () => observation,
  })
  assert.throws(() => wrongDomain.get("bad-domain"), (error) => error.code === "observation_conflict")

  const wrongSource = new WorldObservationRegistry().register("bad-source", {
    domain: "origin", universeId, source: "unknown.source", observe: () => observation,
  })
  assert.throws(() => wrongSource.get("bad-source"), (error) => error.code === "unknown_provenance")
})

test("civilization adapter compares timelines without switching the authority record", () => {
  const controller = new CivilizationController(civilizationSpec, { timelineId: "main", snapshotInterval: 50 })
  controller.advance(120)
  controller.branch("ecology-path", { atTick: 60, expectedRevision: 1 })
  const record = controller.exportRecord()
  const before = structuredClone(record)
  const main = createCivilizationObservation({
    spec: civilizationSpec, record, universeId, timelineId: "main",
  })
  const branch = createCivilizationObservation({
    spec: civilizationSpec, record, universeId, timelineId: "ecology-path",
  })

  assert.equal(main.tick, 120)
  assert.equal(branch.tick, 60)
  assert.equal(main.timelineId, "main")
  assert.equal(branch.timelineId, "ecology-path")
  assert.deepEqual(record, before)
})
