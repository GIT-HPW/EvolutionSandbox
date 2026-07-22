// SPDX-License-Identifier: GPL-3.0-or-later

import { advanceCivilization, civilizationSpecHash, createCivilization } from "./engine.mjs"
import { hashHex } from "./prng.mjs"
import { CivilizationError, validateCivilizationSpec, validateCivilizationState } from "./validation.mjs"

const CONTROLLER_FIELDS = [
  "schemaVersion", "specId", "specHash", "revision", "snapshotInterval",
  "activeTimelineId", "control", "timelines",
]
const TIMELINE_FIELDS = [
  "timelineId", "parentTimelineId", "branchTick", "branchHistoryHash",
  "state", "events", "checkpoints",
]
const CHECKPOINT_FIELDS = [
  "schemaVersion", "timelineId", "tick", "specHash", "historyHash",
  "previousCheckpointHash", "state", "checkpointHash",
]
const CONTROL_FIELDS = ["mode", "speed"]
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HASH_PATTERN = /^[0-9a-f]{8}$/
const MAX_BATCH_TICKS = 10000
const MAX_EVENT_LOG = 4096
const MAX_TIMELINES = 256

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requireObject(value, path) {
  if (!plainObject(value)) throw new CivilizationError("invalid_controller", `${path} must be an object`)
}

function requireExactFields(value, fields, path) {
  requireObject(value, path)
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) throw new CivilizationError("invalid_controller", `${path}.${field} is not allowed`)
  }
  for (const field of fields) {
    if (!(field in value)) throw new CivilizationError("invalid_controller", `${path}.${field} is required`)
  }
}

function requireInteger(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CivilizationError("invalid_controller", `${path} must be an integer from ${min} to ${max}`)
  }
}

function requireId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new CivilizationError("invalid_controller", `${path} must be a valid identifier`)
  }
}

function requireHash(value, path) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new CivilizationError("invalid_controller", `${path} must be an 8-digit lowercase hexadecimal hash`)
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function checkpointCore(checkpoint) {
  const { checkpointHash: ignored, ...core } = checkpoint
  return core
}

function createCheckpoint(spec, timelineId, state, previousCheckpointHash = null) {
  requireId(timelineId, "timelineId")
  const specHash = civilizationSpecHash(spec)
  const checkedState = validateCivilizationState(spec, state, specHash)
  if (previousCheckpointHash !== null) requireHash(previousCheckpointHash, "previousCheckpointHash")
  const checkpoint = {
    schemaVersion: 1,
    timelineId,
    tick: checkedState.tick,
    specHash,
    historyHash: checkedState.historyHash,
    previousCheckpointHash,
    state: checkedState,
    checkpointHash: "00000000",
  }
  checkpoint.checkpointHash = hashHex(canonicalJson(checkpointCore(checkpoint)))
  return checkpoint
}

export function validateCivilizationCheckpoint(input, checkpoint) {
  const spec = validateCivilizationSpec(input)
  const specHash = civilizationSpecHash(spec)
  requireExactFields(checkpoint, CHECKPOINT_FIELDS, "checkpoint")
  if (checkpoint.schemaVersion !== 1) throw new CivilizationError("invalid_controller", "checkpoint.schemaVersion must be 1")
  requireId(checkpoint.timelineId, "checkpoint.timelineId")
  requireInteger(checkpoint.tick, "checkpoint.tick", { max: spec.stopConditions.maxTicks })
  requireHash(checkpoint.specHash, "checkpoint.specHash")
  requireHash(checkpoint.historyHash, "checkpoint.historyHash")
  if (checkpoint.previousCheckpointHash !== null) requireHash(checkpoint.previousCheckpointHash, "checkpoint.previousCheckpointHash")
  requireHash(checkpoint.checkpointHash, "checkpoint.checkpointHash")
  const state = validateCivilizationState(spec, checkpoint.state, specHash)
  if (checkpoint.specHash !== specHash || checkpoint.tick !== state.tick || checkpoint.historyHash !== state.historyHash) {
    throw new CivilizationError("checkpoint_conflict", "checkpoint metadata does not match its civilization state")
  }
  const expectedHash = hashHex(canonicalJson(checkpointCore(checkpoint)))
  if (checkpoint.checkpointHash !== expectedHash) {
    throw new CivilizationError("checkpoint_corrupt", "checkpoint hash does not match its contents")
  }
  return structuredClone(checkpoint)
}

export function replayCivilization(input, checkpoint, targetTick) {
  const spec = validateCivilizationSpec(input)
  const verified = validateCivilizationCheckpoint(spec, checkpoint)
  requireInteger(targetTick, "targetTick", { min: verified.tick, max: spec.stopConditions.maxTicks })
  let state = verified.state
  const events = []
  while (state.tick < targetTick && state.status === "running") {
    const count = Math.min(MAX_BATCH_TICKS, targetTick - state.tick)
    const result = advanceCivilization(spec, state, count)
    state = result.state
    events.push(...result.events)
  }
  if (state.tick !== targetTick) {
    throw new CivilizationError("replay_unreachable", `civilization stopped at tick ${state.tick} before target tick ${targetTick}`)
  }
  return { state, events }
}

function validateEventLog(events, state, branchTick, path) {
  if (!Array.isArray(events) || events.length > MAX_EVENT_LOG) {
    throw new CivilizationError("invalid_controller", `${path} must contain at most ${MAX_EVENT_LOG} events`)
  }
  let previousCursor = -1
  for (const [index, event] of events.entries()) {
    const eventPath = `${path}[${index}]`
    requireExactFields(event, ["cursor", "tick", "type", "title", "effects"], eventPath)
    requireInteger(event.cursor, `${eventPath}.cursor`, { max: state.eventCursor })
    requireInteger(event.tick, `${eventPath}.tick`, { min: branchTick, max: state.tick })
    if (event.cursor <= previousCursor) throw new CivilizationError("invalid_controller", `${path} cursors must be ordered`)
    if (typeof event.type !== "string" || event.type.length < 1 || event.type.length > 64) {
      throw new CivilizationError("invalid_controller", `${eventPath}.type is invalid`)
    }
    if (typeof event.title !== "string" || event.title.length < 1 || event.title.length > 128) {
      throw new CivilizationError("invalid_controller", `${eventPath}.title is invalid`)
    }
    requireObject(event.effects, `${eventPath}.effects`)
    previousCursor = event.cursor
  }
}

function replayFromNearestCheckpoint(spec, timeline, targetTick) {
  if (targetTick < timeline.branchTick || targetTick > timeline.state.tick) {
    throw new CivilizationError("invalid_branch", `tick must be between ${timeline.branchTick} and ${timeline.state.tick}`)
  }
  const checkpoint = timeline.checkpoints.findLast((candidate) => candidate.tick <= targetTick)
  if (!checkpoint) throw new CivilizationError("checkpoint_missing", `timeline ${timeline.timelineId} has no usable checkpoint`)
  return replayCivilization(spec, checkpoint, targetTick)
}

function validateTimeline(spec, input, snapshotInterval, specHash, path) {
  requireExactFields(input, TIMELINE_FIELDS, path)
  requireId(input.timelineId, `${path}.timelineId`)
  if (input.parentTimelineId !== null) requireId(input.parentTimelineId, `${path}.parentTimelineId`)
  requireInteger(input.branchTick, `${path}.branchTick`, { max: spec.stopConditions.maxTicks })
  requireHash(input.branchHistoryHash, `${path}.branchHistoryHash`)
  const state = validateCivilizationState(spec, input.state, specHash)
  if (state.tick < input.branchTick) throw new CivilizationError("invalid_controller", `${path}.state precedes its branch tick`)
  validateEventLog(input.events, state, input.branchTick, `${path}.events`)
  if (!Array.isArray(input.checkpoints) || input.checkpoints.length < 1) {
    throw new CivilizationError("invalid_controller", `${path}.checkpoints must not be empty`)
  }

  let previous
  for (const [index, candidate] of input.checkpoints.entries()) {
    const checkpoint = validateCivilizationCheckpoint(spec, candidate)
    if (checkpoint.timelineId !== input.timelineId) {
      throw new CivilizationError("checkpoint_conflict", `${path}.checkpoints[${index}] belongs to another timeline`)
    }
    if (index === 0) {
      if (checkpoint.tick !== input.branchTick || checkpoint.previousCheckpointHash !== null) {
        throw new CivilizationError("checkpoint_conflict", `${path} must begin with an unchained branch checkpoint`)
      }
    } else {
      if (checkpoint.tick <= previous.tick || checkpoint.previousCheckpointHash !== previous.checkpointHash) {
        throw new CivilizationError("checkpoint_conflict", `${path}.checkpoints must form an ordered hash chain`)
      }
      if (checkpoint.tick % snapshotInterval !== 0 && checkpoint.state.status === "running") {
        throw new CivilizationError("checkpoint_conflict", `${path}.checkpoints contains an off-interval running checkpoint`)
      }
      const replayed = replayCivilization(spec, previous, checkpoint.tick)
      if (canonicalJson(replayed.state) !== canonicalJson(checkpoint.state)) {
        throw new CivilizationError("replay_mismatch", `${path}.checkpoints[${index}] does not follow deterministic replay`)
      }
    }
    previous = checkpoint
  }
  const replayed = replayCivilization(spec, previous, state.tick)
  if (canonicalJson(replayed.state) !== canonicalJson(state)) {
    throw new CivilizationError("replay_mismatch", `${path}.state does not follow its latest checkpoint`)
  }
  if (input.branchHistoryHash !== input.checkpoints[0].historyHash) {
    throw new CivilizationError("checkpoint_conflict", `${path}.branchHistoryHash does not match its first checkpoint`)
  }
  return structuredClone(input)
}

export function validateCivilizationControllerRecord(input, record) {
  const spec = validateCivilizationSpec(input)
  const specHash = civilizationSpecHash(spec)
  requireExactFields(record, CONTROLLER_FIELDS, "controller")
  if (record.schemaVersion !== 1) throw new CivilizationError("invalid_controller", "controller.schemaVersion must be 1")
  if (record.specId !== spec.id || record.specHash !== specHash) {
    throw new CivilizationError("civilization_conflict", "controller does not belong to this civilization specification")
  }
  requireInteger(record.revision, "controller.revision")
  requireInteger(record.snapshotInterval, "controller.snapshotInterval", { min: 1, max: 10000 })
  requireId(record.activeTimelineId, "controller.activeTimelineId")
  requireExactFields(record.control, CONTROL_FIELDS, "controller.control")
  if (!new Set(["paused", "running"]).has(record.control.mode)) {
    throw new CivilizationError("invalid_controller", "controller.control.mode is invalid")
  }
  requireInteger(record.control.speed, "controller.control.speed", { min: 1, max: 10000 })
  if (!Array.isArray(record.timelines) || record.timelines.length < 1 || record.timelines.length > MAX_TIMELINES) {
    throw new CivilizationError("invalid_controller", `controller.timelines must contain 1-${MAX_TIMELINES} timelines`)
  }

  const timelines = record.timelines.map((timeline, index) => validateTimeline(
    spec, timeline, record.snapshotInterval, specHash, `controller.timelines[${index}]`,
  ))
  const byId = new Map()
  for (const timeline of timelines) {
    if (byId.has(timeline.timelineId)) throw new CivilizationError("invalid_controller", "timeline ids must be unique")
    byId.set(timeline.timelineId, timeline)
  }
  if (!byId.has(record.activeTimelineId)) throw new CivilizationError("invalid_controller", "active timeline does not exist")

  for (const timeline of timelines) {
    if (timeline.parentTimelineId === null) {
      if (timeline.branchTick !== 0) throw new CivilizationError("invalid_controller", "root timeline must start at tick 0")
      const genesis = createCivilization(spec)
      if (canonicalJson(timeline.checkpoints[0].state) !== canonicalJson(genesis)) {
        throw new CivilizationError("replay_mismatch", `root timeline ${timeline.timelineId} does not match deterministic genesis`)
      }
      continue
    }
    const parent = byId.get(timeline.parentTimelineId)
    if (!parent || parent.timelineId === timeline.timelineId) {
      throw new CivilizationError("invalid_controller", `timeline ${timeline.timelineId} has an invalid parent`)
    }
    const source = replayFromNearestCheckpoint(spec, parent, timeline.branchTick).state
    if (source.historyHash !== timeline.branchHistoryHash || canonicalJson(source) !== canonicalJson(timeline.checkpoints[0].state)) {
      throw new CivilizationError("replay_mismatch", `timeline ${timeline.timelineId} does not match its parent at the branch tick`)
    }
  }

  for (const timeline of timelines) {
    const visited = new Set([timeline.timelineId])
    let parentId = timeline.parentTimelineId
    while (parentId !== null) {
      if (visited.has(parentId)) throw new CivilizationError("invalid_controller", "timeline ancestry contains a cycle")
      visited.add(parentId)
      parentId = byId.get(parentId)?.parentTimelineId ?? null
    }
  }
  return structuredClone(record)
}

function publicTimeline(timeline) {
  return {
    timelineId: timeline.timelineId,
    parentTimelineId: timeline.parentTimelineId,
    branchTick: timeline.branchTick,
    tick: timeline.state.tick,
    status: timeline.state.status,
    historyHash: timeline.state.historyHash,
    checkpointCount: timeline.checkpoints.length,
    latestCheckpointHash: timeline.checkpoints.at(-1).checkpointHash,
  }
}

export class CivilizationController {
  constructor(input, { timelineId = "origin", snapshotInterval = 100, record } = {}) {
    this._spec = validateCivilizationSpec(input)
    if (record !== undefined) {
      this._record = validateCivilizationControllerRecord(this._spec, record)
      return
    }
    requireId(timelineId, "timelineId")
    requireInteger(snapshotInterval, "snapshotInterval", { min: 1, max: 10000 })
    const state = createCivilization(this._spec)
    const checkpoint = createCheckpoint(this._spec, timelineId, state)
    this._record = {
      schemaVersion: 1,
      specId: this._spec.id,
      specHash: civilizationSpecHash(this._spec),
      revision: 0,
      snapshotInterval,
      activeTimelineId: timelineId,
      control: { mode: "paused", speed: 1 },
      timelines: [{
        timelineId,
        parentTimelineId: null,
        branchTick: 0,
        branchHistoryHash: state.historyHash,
        state,
        events: [],
        checkpoints: [checkpoint],
      }],
    }
  }

  static restore(input, record) {
    return new CivilizationController(input, { record })
  }

  _expectRevision(expectedRevision) {
    if (expectedRevision === undefined) return
    requireInteger(expectedRevision, "expectedRevision")
    if (expectedRevision !== this._record.revision) {
      throw new CivilizationError(
        "revision_conflict",
        `expected revision ${expectedRevision}, current revision is ${this._record.revision}`,
      )
    }
  }

  _activeTimeline() {
    return this._record.timelines.find((timeline) => timeline.timelineId === this._record.activeTimelineId)
  }

  _advance(ticks) {
    requireInteger(ticks, "ticks", { min: 1, max: this._spec.stopConditions.maxTicks })
    const timeline = this._activeTimeline()
    if (timeline.state.status !== "running") {
      throw new CivilizationError("civilization_stopped", `civilization is ${timeline.state.status}`)
    }
    let remaining = ticks
    const events = []
    while (remaining > 0 && timeline.state.status === "running") {
      const nextInterval = (Math.floor(timeline.state.tick / this._record.snapshotInterval) + 1) * this._record.snapshotInterval
      const count = Math.min(remaining, MAX_BATCH_TICKS, nextInterval - timeline.state.tick)
      const result = advanceCivilization(this._spec, timeline.state, count)
      const advanced = result.state.tick - timeline.state.tick
      timeline.state = result.state
      remaining -= advanced
      events.push(...result.events)
      timeline.events.push(...result.events)
      if (timeline.events.length > MAX_EVENT_LOG) timeline.events.splice(0, timeline.events.length - MAX_EVENT_LOG)
      const shouldCheckpoint = timeline.state.tick === nextInterval || timeline.state.status !== "running"
      if (shouldCheckpoint && timeline.checkpoints.at(-1).tick !== timeline.state.tick) {
        timeline.checkpoints.push(createCheckpoint(
          this._spec,
          timeline.timelineId,
          timeline.state,
          timeline.checkpoints.at(-1).checkpointHash,
        ))
      }
      if (advanced === 0) break
    }
    this._record.revision += 1
    return { revision: this._record.revision, state: structuredClone(timeline.state), events: structuredClone(events) }
  }

  advance(ticks, { expectedRevision } = {}) {
    this._expectRevision(expectedRevision)
    return this._advance(ticks)
  }

  pulse({ expectedRevision } = {}) {
    this._expectRevision(expectedRevision)
    if (this._record.control.mode !== "running") {
      throw new CivilizationError("simulation_paused", "scheduled pulse requires running mode")
    }
    return this._advance(this._record.control.speed)
  }

  control(action, { expectedRevision, speed } = {}) {
    this._expectRevision(expectedRevision)
    if (action === "step") {
      if (this._record.control.mode !== "paused") {
        throw new CivilizationError("invalid_control", "step requires paused mode")
      }
      return this._advance(1)
    }
    if (action === "pause") this._record.control.mode = "paused"
    else if (action === "resume") this._record.control.mode = "running"
    else if (action === "set_speed") {
      requireInteger(speed, "speed", { min: 1, max: 10000 })
      this._record.control.speed = speed
    } else {
      throw new CivilizationError("invalid_control", `unknown control action ${action}`)
    }
    this._record.revision += 1
    return { revision: this._record.revision, control: structuredClone(this._record.control) }
  }

  branch(newTimelineId, { atTick = this._activeTimeline().state.tick, fromTimelineId = this._record.activeTimelineId, expectedRevision } = {}) {
    this._expectRevision(expectedRevision)
    requireId(newTimelineId, "newTimelineId")
    if (this._record.timelines.length >= MAX_TIMELINES) throw new CivilizationError("timeline_limit", "timeline limit reached")
    if (this._record.timelines.some((timeline) => timeline.timelineId === newTimelineId)) {
      throw new CivilizationError("timeline_conflict", `timeline ${newTimelineId} already exists`)
    }
    requireId(fromTimelineId, "fromTimelineId")
    const parent = this._record.timelines.find((timeline) => timeline.timelineId === fromTimelineId)
    if (!parent) throw new CivilizationError("timeline_not_found", `timeline ${fromTimelineId} does not exist`)
    requireInteger(atTick, "atTick", { min: parent.branchTick, max: parent.state.tick })
    const state = replayFromNearestCheckpoint(this._spec, parent, atTick).state
    const checkpoint = createCheckpoint(this._spec, newTimelineId, state)
    this._record.timelines.push({
      timelineId: newTimelineId,
      parentTimelineId: parent.timelineId,
      branchTick: atTick,
      branchHistoryHash: state.historyHash,
      state,
      events: [],
      checkpoints: [checkpoint],
    })
    this._record.activeTimelineId = newTimelineId
    this._record.control.mode = "paused"
    this._record.revision += 1
    return { revision: this._record.revision, timeline: publicTimeline(this._activeTimeline()), state: structuredClone(state) }
  }

  switchTimeline(timelineId, { expectedRevision } = {}) {
    this._expectRevision(expectedRevision)
    requireId(timelineId, "timelineId")
    if (!this._record.timelines.some((timeline) => timeline.timelineId === timelineId)) {
      throw new CivilizationError("timeline_not_found", `timeline ${timelineId} does not exist`)
    }
    this._record.activeTimelineId = timelineId
    this._record.control.mode = "paused"
    this._record.revision += 1
    return { revision: this._record.revision, timeline: publicTimeline(this._activeTimeline()) }
  }

  snapshot({ recentEvents = 32 } = {}) {
    requireInteger(recentEvents, "recentEvents", { max: 256 })
    const timeline = this._activeTimeline()
    return {
      schemaVersion: 1,
      specId: this._record.specId,
      specHash: this._record.specHash,
      revision: this._record.revision,
      control: structuredClone(this._record.control),
      activeTimelineId: this._record.activeTimelineId,
      state: structuredClone(timeline.state),
      timelines: this._record.timelines.map(publicTimeline),
      recentEvents: structuredClone(timeline.events.slice(-recentEvents)),
    }
  }

  exportRecord() {
    return structuredClone(this._record)
  }

  get revision() {
    return this._record.revision
  }
}
