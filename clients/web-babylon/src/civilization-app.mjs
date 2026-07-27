// SPDX-License-Identifier: GPL-3.0-or-later

import { CivilizationObservatory } from "./civilization-observatory.mjs"
import { createCivilizationScene } from "./civilization-scene.mjs"
import { bindSceneOptions } from "./scene-flow.mjs"

const STORAGE_KEY = "evolution-sandbox.civilization-observatory.v1"
const UNIVERSE_ID = "universe-1"
const SPEEDS = [1, 4, 16, 64]
const PRIMARY_METRICS = new Set([
  "population", "resources", "knowledge", "ecology", "cohesion", "configuredTimeScale",
])
const METRIC_SCALES = {
  population: 5000,
  resources: 1000,
  knowledge: 1000,
  ecology: 100,
  cohesion: 100,
  configuredTimeScale: 64,
}
const ERA_COPY = {
  origin: ["文明原生期", "观察创始群体如何在资源、知识、生态与凝聚力之间建立第一组反馈。"],
  settlement: ["聚落扩展期", "定居网络正在形成；事件流开始暴露增长与生态承载之间的张力。"],
  civic: ["制度协同期", "制度、知识和群体关系成为决定长期路径的主要变量。"],
  planetary: ["行星文明期", "文明已形成行星尺度结构，可以通过时间线比较观察不同因果路径。"],
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches

const canvas = document.querySelector("#render-canvas")
const scene = createCivilizationScene(canvas, { reducedMotion })
const phaseBadge = document.querySelector("#phase-badge")
const objective = document.querySelector("#objective")
const provenance = document.querySelector("#observation-provenance")
const stats = document.querySelector("#stats")
const feedback = document.querySelector("#feedback")
const eventLog = document.querySelector("#event-log")
const runButton = document.querySelector("#civilization-run")
const stepButton = document.querySelector("#civilization-step")
const advanceButton = document.querySelector("#civilization-advance")
const speedButton = document.querySelector("#civilization-speed")
const resetButton = document.querySelector("#civilization-reset")
const timelineSelect = document.querySelector("#timeline-select")
const comparisonSelect = document.querySelector("#comparison-select")
const causalStatus = document.querySelector("#causal-status")
const comparisonStatus = document.querySelector("#comparison-status")
const comparisonMetrics = document.querySelector("#comparison-metrics")
const experimentForm = document.querySelector("#experiment-form")
const experimentIntent = document.querySelector("#experiment-intent")
const experimentMagnitude = document.querySelector("#experiment-magnitude")
const experimentTimeline = document.querySelector("#experiment-timeline")
const experimentReview = document.querySelector("#experiment-review")
const experimentSummary = document.querySelector("#experiment-summary")
const experimentAudit = document.querySelector("#experiment-audit")
const experimentConfirm = document.querySelector("#experiment-confirm")
const experimentDiscard = document.querySelector("#experiment-discard")
const fallback = document.querySelector("#render-fallback")

let spec
let observatory
let busy = true
let menuSuspended = false
let timer
let sceneOptions
let comparisonTarget
let pendingExperiment

if (!scene.supported) fallback.hidden = false

function metricMap(observation) {
  return new Map(observation.summary.metrics.map((entry) => [entry.id, entry]))
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(observatory.exportRecord()))
}

function setFeedback(text, tone = "info") {
  feedback.textContent = text
  feedback.dataset.tone = tone
}

function option(value, label = value) {
  const result = document.createElement("option")
  result.value = value
  result.textContent = label
  return result
}

function renderTimelineControls(observation, timelineEntries) {
  const timelineIds = timelineEntries.map((entry) => entry.observation.timelineId)
  timelineSelect.replaceChildren(...timelineIds.map((id) => option(id, id === observation.timelineId ? `${id}（当前）` : id)))
  timelineSelect.value = observation.timelineId
  if (!comparisonTarget || !timelineIds.includes(comparisonTarget)) {
    comparisonTarget = timelineIds.find((id) => id !== observation.timelineId) ?? observation.timelineId
  }
  comparisonSelect.replaceChildren(...timelineIds.map((id) => option(id)))
  comparisonSelect.value = comparisonTarget
  timelineSelect.disabled = busy || menuSuspended || timelineIds.length < 2
  comparisonSelect.disabled = busy || timelineIds.length < 2
  const terminal = ["completed", "collapsed"].includes(observation.summary.status)
  const experimentLocked = busy || menuSuspended || observation.timeScale > 0 || terminal || pendingExperiment !== undefined
  experimentIntent.disabled = experimentLocked
  experimentMagnitude.disabled = experimentLocked
  experimentTimeline.disabled = experimentLocked
  experimentForm.querySelector("button").disabled = experimentLocked
}

function renderCausality(metrics) {
  const status = metrics.get("causalStatus")?.value
  if (status === "verified_experiment") {
    const intent = metrics.get("experimentIntent")?.value
    const option = observatory.experimentOptions().find((entry) => entry.id === intent)
    causalStatus.textContent = `已验证实验因果 · ${option?.label ?? intent} ×${metrics.get("experimentMagnitude")?.value} · ${metrics.get("experimentProposalId")?.value}`
  } else if (status === "unattributed_branch") {
    causalStatus.textContent = "普通分支继承父时间线规则；没有声明新的实验因果。"
  } else {
    causalStatus.textContent = "基准时间线 · 使用 CivilizationSpec 原始规则。"
  }
}

function renderExperimentReview() {
  experimentReview.hidden = pendingExperiment === undefined
  if (!pendingExperiment) return
  const { proposal, patch } = pendingExperiment
  const selected = observatory.experimentOptions().find((entry) => entry.id === proposal.intent)
  const changes = Object.entries(patch)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`)
    .join(" · ")
  experimentSummary.textContent = `${selected?.label ?? proposal.intent} ×${proposal.magnitude}：${selected?.summary ?? proposal.rationale} 规则偏移 ${changes}。`
  experimentAudit.textContent = `${proposal.proposalId} · ${proposal.sourceTimelineId}@tick ${proposal.sourceTick} · history ${proposal.sourceHistoryHash} · expected revision ${proposal.expectedRevision}`
  experimentConfirm.disabled = busy || menuSuspended
  experimentDiscard.disabled = busy || menuSuspended
}

function populateExperimentOptions() {
  const selected = experimentIntent.value
  const options = observatory.experimentOptions()
  experimentIntent.replaceChildren(...options.map((entry) => option(entry.id, entry.label)))
  if (options.some((entry) => entry.id === selected)) experimentIntent.value = selected
}

function renderComparison(observation, timelineEntries) {
  comparisonMetrics.replaceChildren()
  if (!comparisonTarget || comparisonTarget === observation.timelineId) {
    comparisonStatus.textContent = timelineEntries.length < 2
      ? "创建第一条分支后，可以比较两个时间线的确认状态。"
      : "请选择另一条时间线进行比较。"
    return
  }
  const comparison = observatory.compare(comparisonTarget, observation.timelineId)
  comparisonStatus.textContent = `${comparisonTarget} → ${observation.timelineId} · tick 差 ${comparison.tickDelta >= 0 ? "+" : ""}${comparison.tickDelta} · revision 差 ${comparison.revisionDelta >= 0 ? "+" : ""}${comparison.revisionDelta}`
  const labels = new Map(observation.summary.metrics.map((entry) => [entry.id, entry.label]))
  const changed = comparison.metricChanges.filter((entry) => entry.left !== null && entry.right !== null && entry.left !== entry.right)
  const visible = changed.length > 0 ? changed : comparison.metricChanges.filter((entry) => entry.left !== null && entry.right !== null).slice(0, 3)
  comparisonMetrics.replaceChildren(...visible.map((entry) => {
    const item = document.createElement("li")
    const title = document.createElement("span")
    title.textContent = labels.get(entry.id) ?? entry.id
    const values = document.createElement("strong")
    values.textContent = `${entry.left} → ${entry.right}`
    item.append(title, values)
    return item
  }))
}

function renderEvents(observation) {
  const events = [...observation.recentEvents].reverse()
  if (events.length === 0) {
    const empty = document.createElement("li")
    empty.textContent = "权威事件流尚为空；推进时间后将在这里显示确认事件。"
    empty.dataset.tone = "quiet"
    eventLog.replaceChildren(empty)
    return
  }
  eventLog.replaceChildren(...events.slice(0, 9).map((event) => {
    const item = document.createElement("li")
    item.textContent = `tick ${event.tick} · ${event.summary}`
    item.dataset.tone = event.type.includes("era") || event.type.includes("milestone") || event.type.includes("experiment") ? "transition" : "event"
    return item
  }))
}

function render() {
  if (!observatory) {
    for (const button of [runButton, stepButton, advanceButton, speedButton]) button.disabled = true
    for (const control of [timelineSelect, comparisonSelect, experimentIntent, experimentMagnitude, experimentTimeline]) {
      control.disabled = true
    }
    experimentForm.querySelector("button").disabled = true
    experimentReview.hidden = true
    resetButton.disabled = false
    return
  }
  const observation = observatory.observe()
  const timelines = observatory.list()
  const metrics = metricMap(observation)
  const era = ERA_COPY[observation.phase] ?? [observation.phase, "观察层只展示权威控制器已经确认的状态。"]
  phaseBadge.textContent = `${era[0]} · tick ${observation.tick} · revision ${observation.revision}`
  objective.textContent = era[1]
  provenance.textContent = `${observation.provenance.source}@${observation.provenance.sourceVersion} · ${observation.provenance.adapter}`
  stats.replaceChildren(...observation.summary.metrics.filter((entry) => PRIMARY_METRICS.has(entry.id)).map((entry) => {
    const card = document.createElement("div")
    card.className = "stat-card"
    const caption = document.createElement("span")
    caption.textContent = `${entry.label}${entry.unit ? ` · ${entry.unit}` : ""}`
    const value = document.createElement("strong")
    value.textContent = entry.value
    const meter = document.createElement("i")
    meter.style.setProperty("--value", Math.min(1, Number(entry.value) / (METRIC_SCALES[entry.id] ?? 100)))
    card.append(caption, value, meter)
    return card
  }))
  renderEvents(observation)
  renderCausality(metrics)
  renderTimelineControls(observation, timelines)
  renderComparison(observation, timelines)
  renderExperimentReview()

  const running = observation.timeScale > 0
  const terminal = ["completed", "collapsed"].includes(observation.summary.status)
  const configuredSpeed = metrics.get("configuredTimeScale")?.value ?? 1
  runButton.querySelector("strong").textContent = running ? "暂停演化" : terminal ? "演化已结束" : "自主演化"
  speedButton.querySelector("strong").textContent = `时间倍率 ×${configuredSpeed}`
  const proposalPending = pendingExperiment !== undefined
  runButton.disabled = busy || menuSuspended || terminal || proposalPending
  stepButton.disabled = busy || menuSuspended || terminal || running || proposalPending
  advanceButton.disabled = busy || menuSuspended || terminal || running || proposalPending
  speedButton.disabled = busy || menuSuspended || terminal || proposalPending
  resetButton.disabled = busy || menuSuspended || proposalPending
  sceneOptions?.setAvailable(!busy)
  scene.setObservation(observation)
}

function applyResult(result, { message, pulse } = {}) {
  save()
  if (pulse) scene.pulse(pulse)
  const events = result.result?.events ?? []
  if (events.some((event) => event.type === "era_transition")) scene.pulse("timeline_branch")
  setFeedback(message ?? `权威状态已确认：tick ${result.observation.tick}。`, "success")
}

async function mutate(operation, options) {
  if (!observatory || busy || menuSuspended) return
  let succeeded = false
  busy = true
  render()
  try {
    applyResult(operation(), options)
    succeeded = true
  } catch (error) {
    setFeedback(`${error.code ?? "civilization_error"}：${error.message}`, "warning")
  } finally {
    busy = false
    render()
    schedule()
  }
  return succeeded
}

function schedule() {
  clearTimeout(timer)
  if (!observatory || busy || menuSuspended) return
  const observation = observatory.observe()
  if (observation.timeScale === 0 || ["completed", "collapsed"].includes(observation.summary.status)) return
  timer = setTimeout(() => {
    void mutate(() => observatory.pulse())
  }, reducedMotion ? 180 : 560)
}

function reset() {
  if (!spec) return
  clearTimeout(timer)
  observatory = new CivilizationObservatory(spec, { universeId: UNIVERSE_ID })
  comparisonTarget = undefined
  pendingExperiment = undefined
  populateExperimentOptions()
  save()
  scene.pulse("reset")
  fallback.hidden = scene.supported
  busy = false
  setFeedback("文明权威记录已显式重置并暂停。", "success")
  render()
}

runButton.addEventListener("click", () => {
  const running = observatory?.observe().timeScale > 0
  void mutate(
    () => observatory.control(running ? "pause" : "resume"),
    { message: running ? "文明自动演化已暂停。" : "文明自动演化已启动。" },
  )
})
stepButton.addEventListener("click", () => {
  void mutate(() => observatory.control("step"), { message: "已由文明权威精确推进 1 tick。" })
})
advanceButton.addEventListener("click", () => {
  void mutate(() => observatory.advance(25), { message: "已由文明权威推进最多 25 tick。" })
})
speedButton.addEventListener("click", () => {
  const metrics = metricMap(observatory.observe())
  const current = Number(metrics.get("configuredTimeScale")?.value ?? 1)
  const next = SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length]
  void mutate(() => observatory.control("set_speed", { speed: next }), { message: `时间倍率已设为 ×${next}。` })
})
resetButton.addEventListener("click", reset)

timelineSelect.addEventListener("change", () => {
  if (timelineSelect.value === observatory?.observe().timelineId) return
  void mutate(() => observatory.switchTimeline(timelineSelect.value), {
    message: `已切换到时间线 ${timelineSelect.value}；权威控制器保持暂停。`,
  })
})
comparisonSelect.addEventListener("change", () => {
  comparisonTarget = comparisonSelect.value
  if (!busy && observatory) render()
})
experimentForm.addEventListener("submit", (event) => {
  event.preventDefault()
  const newTimelineId = experimentTimeline.value.trim()
  if (!newTimelineId) return
  const selected = observatory.experimentOptions().find((entry) => entry.id === experimentIntent.value)
  try {
    pendingExperiment = observatory.proposeExperiment({
      intent: selected.id,
      magnitude: Number(experimentMagnitude.value),
      newTimelineId,
      title: `${selected.label}实验`,
      rationale: selected.summary,
    })
    setFeedback("实验提案已生成，但尚未改变权威状态；请复核因果来源后再次确认。")
    render()
  } catch (error) {
    setFeedback(`${error.code ?? "experiment_error"}：${error.message}`, "warning")
  }
})
experimentConfirm.addEventListener("click", () => {
  if (!pendingExperiment) return
  const staged = pendingExperiment
  void mutate(
    () => observatory.commitExperiment(staged.proposal),
    { message: `实验提案 ${staged.proposal.proposalId} 已确认并建立权威分支。`, pulse: "timeline_branch" },
  ).then((succeeded) => {
    if (!succeeded) return
    comparisonTarget = staged.proposal.sourceTimelineId
    pendingExperiment = undefined
    experimentTimeline.value = ""
    if (observatory) render()
  })
})
experimentDiscard.addEventListener("click", () => {
  pendingExperiment = undefined
  setFeedback("实验提案已放弃；权威状态没有变化。")
  render()
})

sceneOptions = bindSceneOptions({
  sceneId: "civilization",
  onPause() {
    menuSuspended = true
    clearTimeout(timer)
    render()
  },
  onResume() {
    menuSuspended = false
    render()
    schedule()
  },
  checkpoint() {
    if (!observatory) throw new Error("文明权威状态尚未就绪")
    save()
    const observation = observatory.observe()
    return { revision: observation.revision, tick: observation.tick, phase: observation.phase }
  },
})

async function start() {
  spec = await fetch("./civilization.json").then((response) => {
    if (!response.ok) throw new Error(`文明内容包加载失败：HTTP ${response.status}`)
    return response.json()
  })
  const stored = localStorage.getItem(STORAGE_KEY)
  observatory = new CivilizationObservatory(spec, {
    universeId: UNIVERSE_ID,
    record: stored === null ? undefined : JSON.parse(stored),
  })
  populateExperimentOptions()
  if (stored === null) save()
  busy = false
  const observation = observatory.observe()
  setFeedback(stored === null
    ? "文明观测记录已创建；显示只读取 WorldObservation v0。"
    : `已验证并恢复 ${observation.timelineId} / tick ${observation.tick} 的文明记录。`)
  render()
  if (!sceneOptions.markReady()) return
  schedule()
}

start().catch((error) => {
  clearTimeout(timer)
  observatory = undefined
  busy = false
  phaseBadge.textContent = "文明记录无法恢复"
  objective.textContent = error.message
  provenance.textContent = "记录没有被静默清除。"
  setFeedback("点击“重置文明”可显式创建新记录。", "warning")
  fallback.hidden = false
  render()
})

globalThis.addEventListener("beforeunload", () => scene.dispose(), { once: true })
