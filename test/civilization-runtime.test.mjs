// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  CheckpointCivilizationRuntimeStore,
  CivilizationRuntimeError,
  CivilizationSidecarRuntime,
  MemoryCivilizationRuntimeStore,
  createCivilizationPulseScheduler,
  createMemoryCivilizationRuntimeStore,
} from "../src/interop/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const tidal = JSON.parse(await readFile(
  resolve(root, "content", "civilizations", "presets", "tidal-archive.json"),
  "utf8",
))

test("civilization runtime persists commands and deduplicates scheduled pulse ids", async () => {
  let token = 0
  const runtime = new CivilizationSidecarRuntime({
    store: createMemoryCivilizationRuntimeStore(),
    leaseMs: 100,
    token: () => `worker-${++token}`,
  })
  await runtime.initialize()
  await runtime.create({ spec: tidal, universeId: "universe-1", snapshotInterval: 50 })
  await runtime.execute("set_speed", { speed: 4, expectedRevision: 0 })
  await runtime.execute("resume", { expectedRevision: 1 })

  const first = await runtime.pulse("scheduler-slot-0001", { now: 1000 })
  assert.equal(first.status, "committed")
  assert.equal(first.snapshot.state.tick, 4)
  assert.equal(first.snapshot.revision, 3)

  const duplicate = await runtime.pulse("scheduler-slot-0001", { now: 1001 })
  assert.equal(duplicate.status, "duplicate")
  assert.equal(duplicate.completed.committedRevision, 3)
  assert.equal(duplicate.snapshot.state.tick, 4)

  const second = await runtime.pulse("scheduler-slot-0002", { now: 1001 })
  assert.equal(second.status, "committed")
  assert.equal(second.snapshot.state.tick, 8)
  assert.equal(second.snapshot.revision, 4)
  assert.equal((await runtime.diagnostics(1001)).retainedCompletedPulses, 2)
})

test("paused pulse fails without leaving a lease behind", async () => {
  const runtime = new CivilizationSidecarRuntime({ leaseMs: 100, token: () => "paused-worker" })
  await runtime.initialize()
  await runtime.create({ spec: tidal, universeId: "universe-1" })

  await assert.rejects(
    runtime.pulse("paused-slot", { now: 1000 }),
    (error) => error.code === "simulation_paused",
  )
  assert.equal((await runtime.diagnostics(1000)).pulseLease, null)
  assert.equal(runtime.controllerSnapshot.state.tick, 0)
})

test("pulse scheduler derives stable ids from time slots across repeated polls", async () => {
  const runtime = new CivilizationSidecarRuntime({ leaseMs: 100 })
  await runtime.initialize()
  await runtime.create({ spec: tidal, universeId: "universe-1" })
  await runtime.execute("resume", { expectedRevision: 0 })
  const scheduler = createCivilizationPulseScheduler({ runtime, intervalMs: 1000, epochMs: 1000 })

  assert.deepEqual(await scheduler.runDue(999), { status: "not_due", duplicate: false, pulseId: null })
  const first = await scheduler.runDue(1000)
  const duplicate = await scheduler.runDue(1999)
  const second = await scheduler.runDue(2000)
  assert.equal(first.pulseId, "scheduled-pulse:0")
  assert.equal(first.status, "committed")
  assert.equal(duplicate.pulseId, "scheduled-pulse:0")
  assert.equal(duplicate.status, "duplicate")
  assert.equal(second.pulseId, "scheduled-pulse:1")
  assert.equal(second.snapshot.state.tick, 2)
})

test("commands wait for active pulse leases and can supersede them after expiry", async () => {
  let clock = 1000
  const store = createMemoryCivilizationRuntimeStore()
  const runtime = new CivilizationSidecarRuntime({ store, leaseMs: 100, now: () => clock })
  await runtime.initialize()
  await runtime.create({ spec: tidal, universeId: "universe-1" })
  await runtime.execute("resume", { expectedRevision: 0 })
  await store.acquirePulse({
    pulseId: "operator-recovery-slot",
    now: clock,
    leaseMs: 100,
    token: "lost-worker",
  })

  clock = 1050
  await assert.rejects(
    runtime.execute("pause", { expectedRevision: 1 }),
    (error) => error.code === "pulse_in_flight",
  )
  clock = 1101
  const paused = await runtime.execute("pause", { expectedRevision: 1 })
  assert.equal(paused.snapshot.control.mode, "paused")
  assert.equal(paused.snapshot.state.tick, 0)
  assert.equal((await runtime.diagnostics(clock)).pulseLease, null)
})

test("failed pulse commit keeps the persisted controller unchanged for lease recovery", async () => {
  class FailingStore extends MemoryCivilizationRuntimeStore {
    constructor() {
      super()
      this.writes = 0
      this.failAt = 5
    }

    async _persistState() {
      this.writes += 1
      if (this.writes === this.failAt) throw new Error("simulated pulse checkpoint failure")
    }
  }

  let clock = 1000
  const store = new FailingStore()
  const runtime = new CivilizationSidecarRuntime({
    store,
    leaseMs: 100,
    now: () => clock,
    token: () => `worker-at-${clock}`,
  })
  await runtime.initialize()
  await runtime.create({ spec: tidal, universeId: "universe-1" })
  await runtime.execute("resume", { expectedRevision: 0 })

  await assert.rejects(runtime.pulse("failed-commit-slot", { now: clock }), /checkpoint failure/)
  assert.equal(runtime.controllerSnapshot.state.tick, 0)
  assert.equal(runtime.controllerSnapshot.revision, 1)
  assert.equal((await runtime.diagnostics(clock)).pulseLease.pulseId, "failed-commit-slot")

  store.failAt = Number.MAX_SAFE_INTEGER
  clock = 1101
  const recovered = await runtime.pulse("failed-commit-slot", { now: clock })
  assert.equal(recovered.status, "committed")
  assert.equal(recovered.completed.attempts, 2)
  assert.equal(recovered.snapshot.state.tick, 1)
})

test("checkpoint runtime reclaims an expired pulse lease and survives acknowledgement loss", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-civilization-runtime-"))
  try {
    const firstStore = new CheckpointCivilizationRuntimeStore({ directory })
    const first = new CivilizationSidecarRuntime({ store: firstStore, leaseMs: 100 })
    await first.initialize()
    await first.create({ spec: tidal, universeId: "universe-1" })
    await first.execute("resume", { expectedRevision: 0 })
    const leased = await firstStore.acquirePulse({
      pulseId: "scheduler-slot-recovery",
      now: 1000,
      leaseMs: 100,
      token: "worker-before-crash",
    })
    assert.equal(leased.status, "acquired")
    await first.close()

    const waiting = new CivilizationSidecarRuntime({
      store: new CheckpointCivilizationRuntimeStore({ directory }),
      leaseMs: 100,
      token: () => "worker-too-early",
    })
    await waiting.initialize()
    const inFlight = await waiting.pulse("scheduler-slot-recovery", { now: 1050 })
    assert.equal(inFlight.status, "in_flight")
    assert.equal(inFlight.snapshot.state.tick, 0)
    await waiting.close()

    const recovered = new CivilizationSidecarRuntime({
      store: new CheckpointCivilizationRuntimeStore({ directory }),
      leaseMs: 100,
      token: () => "worker-after-expiry",
    })
    await recovered.initialize()
    const committed = await recovered.pulse("scheduler-slot-recovery", { now: 1101 })
    assert.equal(committed.status, "committed")
    assert.equal(committed.completed.attempts, 2)
    assert.equal(committed.snapshot.state.tick, 1)
    assert.equal(committed.snapshot.revision, 2)
    await recovered.close()

    const afterAckLoss = new CivilizationSidecarRuntime({
      store: new CheckpointCivilizationRuntimeStore({ directory }),
      leaseMs: 100,
    })
    await afterAckLoss.initialize()
    const duplicate = await afterAckLoss.pulse("scheduler-slot-recovery", { now: 1102 })
    assert.equal(duplicate.status, "duplicate")
    assert.equal(duplicate.snapshot.state.tick, 1)
    assert.equal(duplicate.snapshot.revision, 2)
    await afterAckLoss.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("checkpoint runtime rejects another host and corrupted authority data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-civilization-runtime-integrity-"))
  try {
    const runtime = new CivilizationSidecarRuntime({
      store: new CheckpointCivilizationRuntimeStore({ directory }),
      hostId: "civilization-host-a",
    })
    await runtime.initialize()
    await runtime.create({ spec: tidal, universeId: "universe-1" })
    await runtime.close()

    const wrongHost = new CivilizationSidecarRuntime({
      store: new CheckpointCivilizationRuntimeStore({ directory }),
      hostId: "civilization-host-b",
    })
    await assert.rejects(
      wrongHost.initialize(),
      (error) => error instanceof CivilizationRuntimeError && error.code === "runtime_binding_mismatch",
    )

    const checkpointPath = resolve(directory, "civilization-runtime.json")
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"))
    checkpoint.state.authority.controllerRecord.revision = 999
    await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8")
    const corrupted = new CivilizationSidecarRuntime({
      store: new CheckpointCivilizationRuntimeStore({ directory }),
      hostId: "civilization-host-a",
    })
    await assert.rejects(
      corrupted.initialize(),
      (error) => error instanceof CivilizationRuntimeError && error.code === "runtime_checksum_mismatch",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
