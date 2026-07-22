// SPDX-License-Identifier: GPL-3.0-or-later

import { hashHex, randomInt, seedToState } from "../determinism/prng.mjs"
import { StellarError, validateStellarSpec, validateStellarState } from "./validation.mjs"

const MAX_BATCH_TICKS = 10000
const METRIC_LIMIT = 1000000000

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
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

export function stellarSpecHash(input) {
  const spec = validateStellarSpec(input)
  const { $schema: ignored, ...portable } = spec
  return hashHex(canonicalJson(portable))
}

function coreState(state) {
  const { historyHash: ignored, ...core } = state
  return core
}

function addEvent(state, events, type, title, effects = {}) {
  state.eventCursor += 1
  events.push({ cursor: state.eventCursor, tick: state.tick, type, title, effects: structuredClone(effects) })
}

function transition(state, events, phase, milestone, title) {
  state.phase = phase
  state.phaseStartedTick = state.tick
  state.milestones.push({ id: milestone, tick: state.tick })
  addEvent(state, events, "stellar_transition", title, { phase })
}

function accrete(spec, state, roll) {
  const amount = Math.min(state.nebulaMass, spec.physics.accretionRate + roll)
  state.nebulaMass -= amount
  state.stellarMass = clamp(state.stellarMass + amount, 0, METRIC_LIMIT)
  return amount
}

function advanceOne(spec, state) {
  const next = structuredClone(state)
  const events = []
  next.tick += 1

  const variance = randomInt(next.rngState, 3)
  next.rngState = variance.state
  const radiationPulse = randomInt(next.rngState, 100)
  next.rngState = radiationPulse.state

  if (next.phase === "nebula") {
    const amount = accrete(spec, next, variance.value)
    next.corePressure = clamp(next.corePressure + Math.max(1, Math.floor(amount / 3)), 0, 1000)
    next.temperature = clamp(next.temperature + Math.max(1, Math.floor(spec.physics.contractionRate / 2)), 0, 1000)
    next.stability = clamp(next.stability + 1, 0, 100)
    const protostarMass = Math.max(60, Math.floor(spec.physics.ignitionMass * 0.4))
    if (next.stellarMass >= protostarMass && next.corePressure >= 20) {
      transition(next, events, "protostar", "protostar_formed", "物质云形成原恒星")
    }
  } else if (next.phase === "protostar") {
    const amount = accrete(spec, next, variance.value)
    next.corePressure = clamp(next.corePressure + spec.physics.contractionRate + Math.floor(amount / 3), 0, 1000)
    next.temperature = clamp(next.temperature + spec.physics.contractionRate + Math.floor(next.corePressure / 30), 0, 1000)
    next.stability = clamp(next.stability + (next.corePressure < 140 ? 1 : -1), 0, 100)
    if (next.stellarMass >= spec.physics.ignitionMass && next.temperature >= spec.physics.ignitionTemperature) {
      next.fuel = 100
      next.luminosity = clamp(45 + Math.floor(next.temperature / 5), 0, 100)
      next.stability = 72
      transition(next, events, "main_sequence", "star_ignited", "第一颗星辰完成点燃")
    }
  } else if (next.phase === "main_sequence") {
    const burned = Math.min(next.fuel, spec.physics.fusionBurnRate)
    next.fuel -= burned
    next.temperature = clamp(next.temperature + variance.value - 1, 0, 1000)
    next.luminosity = clamp(35 + Math.floor(next.temperature / 4) + Math.floor((100 - next.fuel) / 5) + (radiationPulse.value < 10 ? 1 : 0), 0, 100)
    const targetStability = 74 - Math.floor(Math.abs(55 - next.fuel) / 5)
    next.stability = clamp(next.stability + Math.sign(targetStability - next.stability), 0, 100)
    if ((next.tick - next.phaseStartedTick) % 10 === 0) {
      next.elementDiversity = clamp(next.elementDiversity + 2, 0, 100)
      addEvent(next, events, "fusion_cycle", "星辰完成一次稳定聚变周期", { fuel: -burned, elementDiversity: 2 })
    }
    if (next.fuel <= 15) {
      next.luminosity = 90
      next.stability = 55
      transition(next, events, "red_giant", "main_sequence_completed", "星辰离开稳定燃烧阶段")
    }
  } else if (next.phase === "red_giant") {
    const available = Math.max(0, next.stellarMass - 30)
    const amount = Math.min(available, Math.ceil(spec.physics.accretionRate / 2) + variance.value)
    next.stellarMass -= amount
    next.expelledMatter = clamp(next.expelledMatter + amount, 0, METRIC_LIMIT)
    next.diskMass = clamp(next.diskMass + Math.floor(amount * spec.physics.diskRetention / 100), 0, METRIC_LIMIT)
    next.temperature = clamp(next.temperature + spec.physics.contractionRate, 0, 1000)
    next.luminosity = 100
    next.stability = clamp(next.stability - 3, 0, 100)
    if ((next.tick - next.phaseStartedTick) % 3 === 0) next.elementDiversity = clamp(next.elementDiversity + 1, 0, 100)
    if (next.tick - next.phaseStartedTick >= 12) {
      if (next.stellarMass >= spec.physics.supernovaMassThreshold) {
        transition(next, events, "supernova", "supernova", "星辰核心坍缩，爆发即将发生")
      } else {
        transition(next, events, "planetary_disk", "planetary_disk", "星辰外层散入初生行星盘")
      }
    }
  } else if (next.phase === "supernova") {
    const remnant = Math.max(8, Math.floor(next.stellarMass * 0.18))
    const amount = next.stellarMass - remnant
    next.stellarMass = remnant
    next.expelledMatter = clamp(next.expelledMatter + amount, 0, METRIC_LIMIT)
    next.diskMass = clamp(next.diskMass + Math.floor(amount * spec.physics.diskRetention / 100), 0, METRIC_LIMIT)
    next.elementDiversity = clamp(next.elementDiversity + 12, 0, 100)
    next.corePressure = 1000
    next.temperature = 1000
    next.luminosity = 100
    next.stability = 0
    addEvent(next, events, "stellar_explosion", "星辰爆发并播撒复杂物质", { expelledMatter: amount, elementDiversity: 12 })
    transition(next, events, "planetary_disk", "planetary_disk", "爆发物质形成旋转行星盘")
  } else if (next.phase === "planetary_disk") {
    next.diskStability = clamp(next.diskStability + 4 + variance.value, 0, 100)
    next.luminosity = clamp(next.luminosity - 3, 0, 100)
    next.temperature = clamp(next.temperature - spec.physics.contractionRate, 0, 1000)
    if (next.diskStability >= 100) {
      next.status = "completed"
      addEvent(next, events, "stellar_cycle_completed", "行星盘获得稳定结构", { diskStability: next.diskStability })
    }
  }

  const ignitionFailed = (next.phase === "nebula" || next.phase === "protostar")
    && next.nebulaMass === 0
    && (next.stellarMass < spec.physics.ignitionMass || next.temperature < spec.physics.ignitionTemperature)
  if (ignitionFailed && spec.stopConditions.haltOnFailure) {
    next.status = "collapsed"
    addEvent(next, events, "stellar_ignition_failed", "物质云耗尽，星辰未能点燃", {})
  } else if (next.tick === spec.stopConditions.maxTicks && next.status === "running") {
    next.status = "completed"
    addEvent(next, events, "stellar_simulation_completed", "达到恒星模拟终点", {})
  }

  next.historyHash = hashHex(canonicalJson({
    previous: state.historyHash,
    tick: next.tick,
    state: coreState(next),
    events,
  }))
  return { state: next, events }
}

export function createStellarSystem(input) {
  const spec = validateStellarSpec(input)
  const specHash = stellarSpecHash(spec)
  const state = {
    schemaVersion: 1,
    specId: spec.id,
    specHash,
    name: spec.name,
    tick: 0,
    phase: "nebula",
    phaseStartedTick: 0,
    status: "running",
    nebulaMass: spec.origin.nebulaMass,
    stellarMass: spec.origin.stellarMass,
    corePressure: spec.origin.density,
    temperature: spec.origin.temperature,
    angularMomentum: spec.origin.angularMomentum,
    luminosity: 0,
    stability: 20,
    fuel: 0,
    elementDiversity: spec.origin.elementDiversity,
    expelledMatter: 0,
    diskMass: 0,
    diskStability: 0,
    rngState: seedToState(spec.seed),
    eventCursor: 0,
    historyHash: hashHex(`stellar-genesis:${specHash}`),
    milestones: [{ id: "nebula_formed", tick: 0 }],
  }
  return validateStellarState(spec, state, specHash)
}

export function advanceStellarSystem(input, currentState, ticks = 1) {
  const spec = validateStellarSpec(input)
  const specHash = stellarSpecHash(spec)
  let state = validateStellarState(spec, currentState, specHash)
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > MAX_BATCH_TICKS) {
    throw new StellarError("invalid_advance", `ticks must be an integer from 1 to ${MAX_BATCH_TICKS}`)
  }
  const events = []
  for (let index = 0; index < ticks && state.status === "running"; index += 1) {
    const result = advanceOne(spec, state)
    state = result.state
    events.push(...result.events)
  }
  return { state: validateStellarState(spec, state, specHash), events }
}

export function runStellarSystem(input, { ticks } = {}) {
  const spec = validateStellarSpec(input)
  const targetTicks = ticks ?? spec.stopConditions.maxTicks
  if (!Number.isSafeInteger(targetTicks) || targetTicks < 0 || targetTicks > spec.stopConditions.maxTicks) {
    throw new StellarError("invalid_advance", "target ticks must be within stellar stop conditions")
  }
  let state = createStellarSystem(spec)
  const events = []
  while (state.status === "running" && state.tick < targetTicks) {
    const result = advanceStellarSystem(spec, state, Math.min(MAX_BATCH_TICKS, targetTicks - state.tick))
    state = result.state
    events.push(...result.events)
  }
  return { state, events }
}

export function stellarStatusLine(state) {
  return `tick=${state.tick} 阶段=${state.phase} 状态=${state.status} 星体质量=${state.stellarMass} 温度=${state.temperature} 光度=${state.luminosity} 稳定=${state.stability} 元素=${state.elementDiversity} 盘质量=${state.diskMass} hash=${state.historyHash}`
}
