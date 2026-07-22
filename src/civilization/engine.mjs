// SPDX-License-Identifier: GPL-3.0-or-later

import { hashHex, randomInt, seedToState } from "./prng.mjs"
import { CivilizationError, validateCivilizationSpec, validateCivilizationState } from "./validation.mjs"

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

export function civilizationSpecHash(input) {
  const spec = validateCivilizationSpec(input)
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

function applyEffects(state, effects) {
  state.population = clamp(state.population + (effects.population ?? 0), 0, METRIC_LIMIT)
  state.resources = clamp(state.resources + (effects.resources ?? 0), 0, METRIC_LIMIT)
  state.knowledge = clamp(state.knowledge + (effects.knowledge ?? 0), 0, METRIC_LIMIT)
  state.ecology = clamp(state.ecology + (effects.ecology ?? 0), 0, 100)
  state.cohesion = clamp(state.cohesion + (effects.cohesion ?? 0), 0, 100)
}

function periodicEvent(spec, state, roll, events) {
  if (state.tick % 25 !== 0) return
  let event
  if (state.resources < Math.ceil(state.population / 8)) {
    event = { type: "scarcity_response", title: "资源配给会议", effects: { resources: 12, cohesion: -2 } }
  } else if (spec.values.ecology >= 70 && roll < 25) {
    event = { type: "ecological_bloom", title: "生态群落复苏", effects: { ecology: 3, cohesion: 1 } }
  } else if (spec.values.knowledge >= 65 && roll < 55) {
    event = { type: "archive_breakthrough", title: "知识档案突破", effects: { knowledge: 18 + Math.floor(state.population / 80) } }
  } else if (spec.values.expansion >= 60 && roll < 80) {
    event = { type: "resource_frontier", title: "发现新资源前沿", effects: { resources: 24, ecology: -2 } }
  } else {
    event = { type: "civic_gathering", title: "公共协商周期", effects: { resources: -3, cohesion: 2 } }
  }
  applyEffects(state, event.effects)
  addEvent(state, events, event.type, event.title, event.effects)
}

function advanceEra(state, events) {
  let transition
  if (state.era === "origin" && state.tick >= 50 && state.population >= 150 && state.knowledge >= 150) {
    transition = { era: "settlement", milestone: "era_settlement", title: "进入聚落时代" }
  } else if (state.era === "settlement" && state.tick >= 200 && state.population >= 300 && state.knowledge >= 800) {
    transition = { era: "civic", milestone: "era_civic", title: "进入城邦时代" }
  } else if (state.era === "civic" && state.tick >= 600 && state.population >= 700 && state.knowledge >= 4000 && state.ecology >= 40 && state.cohesion >= 40) {
    transition = { era: "planetary", milestone: "era_planetary", title: "进入行星时代" }
  }
  if (!transition) return
  state.era = transition.era
  state.milestones.push({ id: transition.milestone, tick: state.tick })
  addEvent(state, events, "era_transition", transition.title, { era: transition.era })
}

function advanceOne(spec, state) {
  const next = structuredClone(state)
  const events = []
  next.tick += 1

  const productionRoll = randomInt(next.rngState, 3)
  next.rngState = productionRoll.state
  const production = Math.max(1, Math.floor(next.population * (30 + spec.values.expansion) / 1500)) + productionRoll.value
  const consumption = Math.ceil(next.population / 42) + Math.floor(spec.values.militarism / 45)
  const researchInvestment = Math.floor(spec.values.knowledge / 30)
  const resourceBalance = production - consumption - researchInvestment
  next.resources = clamp(next.resources + resourceBalance, 0, METRIC_LIMIT)

  const capacity = Math.max(50, next.resources * 2 + next.ecology * 4)
  const growthWeight = 2 + Math.floor(next.cohesion / 30) + Math.floor(spec.values.collectivism / 40)
  let populationDelta
  if (next.resources === 0) populationDelta = -Math.max(1, Math.ceil(next.population / 120))
  else if (next.population < capacity) populationDelta = Math.max(1, Math.floor(next.population * growthWeight / 1500))
  else populationDelta = -Math.max(1, Math.ceil((next.population - capacity) / 30))
  next.population = clamp(next.population + populationDelta, 0, METRIC_LIMIT)

  const knowledgeGain = Math.max(1, Math.floor(next.population * (20 + spec.values.knowledge) / 6000)) + researchInvestment
  next.knowledge = clamp(next.knowledge + knowledgeGain, 0, METRIC_LIMIT)

  if (next.tick % 10 === 0) {
    const ecologyDelta = (spec.values.ecology >= 55 ? 1 : 0)
      - (spec.values.expansion >= 85 ? 1 : 0)
      - (next.population > capacity ? 1 : 0)
    next.ecology = clamp(next.ecology + ecologyDelta, 0, 100)
  }
  if (next.tick % 5 === 0) {
    const cohesionDelta = next.resources < consumption * 2
      ? -1
      : (spec.values.collectivism >= 60 ? 1 : 0) - (spec.values.militarism >= 80 ? 1 : 0)
    next.cohesion = clamp(next.cohesion + cohesionDelta, 0, 100)
  }

  const eventRoll = randomInt(next.rngState, 100)
  next.rngState = eventRoll.state
  periodicEvent(spec, next, eventRoll.value, events)
  advanceEra(next, events)

  const collapsed = next.population === 0 || next.ecology === 0 || next.cohesion === 0
  if (collapsed && spec.stopConditions.haltOnCollapse) {
    next.status = "collapsed"
    addEvent(next, events, "civilization_collapsed", "文明演化停止", {})
  } else if (next.tick === spec.stopConditions.maxTicks) {
    next.status = "completed"
    addEvent(next, events, "simulation_completed", "达到设定演化终点", {})
  }

  next.historyHash = hashHex(canonicalJson({
    previous: state.historyHash,
    tick: next.tick,
    state: coreState(next),
    events,
  }))
  return { state: next, events }
}

export function createCivilization(input) {
  const spec = validateCivilizationSpec(input)
  const specHash = civilizationSpecHash(spec)
  const state = {
    schemaVersion: 1,
    specId: spec.id,
    specHash,
    name: spec.name,
    tick: 0,
    era: spec.origin.startingEra,
    status: "running",
    population: spec.origin.founderPopulation,
    resources: spec.origin.resources,
    knowledge: spec.origin.knowledge,
    ecology: spec.origin.ecology,
    cohesion: spec.origin.cohesion,
    rngState: seedToState(spec.seed),
    eventCursor: 0,
    historyHash: hashHex(`genesis:${specHash}`),
    milestones: [{ id: "founding", tick: 0 }],
  }
  return validateCivilizationState(spec, state, specHash)
}

export function advanceCivilization(input, currentState, ticks = 1) {
  const spec = validateCivilizationSpec(input)
  const specHash = civilizationSpecHash(spec)
  let state = validateCivilizationState(spec, currentState, specHash)
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > MAX_BATCH_TICKS) {
    throw new CivilizationError("invalid_advance", `ticks must be an integer from 1 to ${MAX_BATCH_TICKS}`)
  }
  const events = []
  for (let index = 0; index < ticks && state.status === "running"; index += 1) {
    const result = advanceOne(spec, state)
    state = result.state
    events.push(...result.events)
  }
  return { state: validateCivilizationState(spec, state, specHash), events }
}

export function runCivilization(input, { ticks } = {}) {
  const spec = validateCivilizationSpec(input)
  const targetTicks = ticks ?? spec.stopConditions.maxTicks
  if (!Number.isSafeInteger(targetTicks) || targetTicks < 0 || targetTicks > spec.stopConditions.maxTicks) {
    throw new CivilizationError("invalid_advance", "target ticks must be within the civilization stop conditions")
  }
  let state = createCivilization(spec)
  const events = []
  while (state.status === "running" && state.tick < targetTicks) {
    const count = Math.min(MAX_BATCH_TICKS, targetTicks - state.tick)
    const result = advanceCivilization(spec, state, count)
    state = result.state
    events.push(...result.events)
  }
  return { state, events }
}

export function civilizationStatusLine(state) {
  return `tick=${state.tick} 时代=${state.era} 状态=${state.status} 人口=${state.population} 资源=${state.resources} 知识=${state.knowledge} 生态=${state.ecology} 凝聚=${state.cohesion} hash=${state.historyHash}`
}
