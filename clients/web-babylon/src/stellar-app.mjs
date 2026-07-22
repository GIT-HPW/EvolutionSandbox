// SPDX-License-Identifier: GPL-3.0-or-later

import { StellarController } from "../../../src/stellar/controller.mjs"
import { validateStellarSpec } from "../../../src/stellar/validation.mjs"
import { stellarJourney } from "./stellar-progression.mjs"
import { createStellarScene } from "./stellar-scene.mjs"

const STORAGE_KEY = "evolution-sandbox.stellar-controller.v1"
const SPEEDS = [1, 4, 16]
const phases = {
  nebula: ["原始物质云", "聚集正在推动新的聚集，核心仍隐藏在黑暗之中。"],
  protostar: ["原恒星", "持续收缩正在提高核心压力与温度。"],
  main_sequence: ["稳定星辰", "向内聚集和向外释放形成暂时的动态平衡。"],
  red_giant: ["衰老星辰", "燃料结构改变，外层扩张并把复杂物质带向远方。"],
  supernova: ["核心坍缩", "旧边界即将打开，星辰积累的信息将重新进入宇宙。"],
  planetary_disk: ["初生行星盘", "星辰遗产正在旋转、碰撞并寻找能够延续的新结构。"],
}
const labels = {
  stellarMass: "星体质量",
  corePressure: "核心压力",
  temperature: "温度",
  luminosity: "光度",
  stability: "稳定",
  elementDiversity: "复杂物质",
  diskMass: "行星盘质量",
  diskStability: "行星盘结构",
}
const scales = { stellarMass: 230, corePressure: 250, temperature: 1000, luminosity: 100, stability: 100, elementDiversity: 30, diskMass: 140, diskStability: 100 }
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches

const canvas = document.querySelector("#render-canvas")
const scene = createStellarScene(canvas, { reducedMotion })
const stage = document.querySelector(".stage")
const phaseBadge = document.querySelector("#phase-badge")
const objective = document.querySelector("#objective")
const missionPanel = document.querySelector("#mission-panel")
const missionStatus = document.querySelector("#mission-status")
const missionSteps = document.querySelector("#mission-steps")
const stats = document.querySelector("#stats")
const feedback = document.querySelector("#feedback")
const eventLog = document.querySelector("#event-log")
const runButton = document.querySelector("#stellar-run")
const stepButton = document.querySelector("#stellar-step")
const advanceButton = document.querySelector("#stellar-advance")
const speedButton = document.querySelector("#stellar-speed")
const resetButton = document.querySelector("#stellar-reset")
const fallback = document.querySelector("#render-fallback")
const transition = document.querySelector("#stellar-transition")

let spec
let controller
let busy = true
let timer
let cinematic = false

if (!scene.supported) fallback.hidden = false

function addEvent(text, tone = "event") {
  const item = document.createElement("li")
  item.textContent = text
  item.dataset.tone = tone
  eventLog.prepend(item)
  while (eventLog.children.length > 8) eventLog.lastElementChild.remove()
}

function setFeedback(text, tone = "info") {
  feedback.textContent = text
  feedback.dataset.tone = tone
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(controller.exportRecord()))
}

function renderJourney(state) {
  const journey = stellarJourney(state)
  missionPanel.dataset.complete = String(journey.complete)
  missionStatus.textContent = journey.complete ? "恒星循环完成" : `${journey.completed} / ${journey.total}`
  missionSteps.replaceChildren(...journey.steps.map((step) => {
    const item = document.createElement("li")
    item.dataset.complete = String(step.complete)
    const title = document.createElement("strong")
    title.textContent = step.title
    const detail = document.createElement("span")
    detail.textContent = step.complete ? "权威状态已确认" : step.detail
    item.append(title, detail)
    return item
  }))
}

function render() {
  if (!controller) {
    for (const button of [runButton, stepButton, advanceButton, speedButton]) button.disabled = true
    resetButton.disabled = false
    return
  }
  const snapshot = controller.snapshot()
  const state = snapshot.state
  const phase = phases[state.phase] ?? [state.phase, ""]
  phaseBadge.textContent = `${phase[0]} · tick ${state.tick} · revision ${snapshot.revision}`
  objective.textContent = phase[1]
  renderJourney(state)
  stats.replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const card = document.createElement("div")
    card.className = "stat-card"
    const caption = document.createElement("span")
    caption.textContent = label
    const value = document.createElement("strong")
    value.textContent = state[key]
    const meter = document.createElement("i")
    meter.style.setProperty("--value", Math.min(1, state[key] / scales[key]))
    card.append(caption, value, meter)
    return card
  }))
  const running = snapshot.control.mode === "running"
  const stopped = state.status !== "running"
  runButton.textContent = running ? "暂停演化" : stopped ? "演化已完成" : "自主演化"
  speedButton.textContent = `时间倍率 ×${snapshot.control.speed}`
  runButton.disabled = busy || stopped
  stepButton.disabled = busy || stopped || running
  advanceButton.disabled = busy || stopped || running
  speedButton.disabled = busy || stopped
  resetButton.disabled = busy
  scene.setState(state)
}

async function playExplosion() {
  if (cinematic) return
  cinematic = true
  transition.hidden = false
  stage.dataset.cinematic = "true"
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  transition.classList.add("active")
  await new Promise((resolve) => setTimeout(resolve, reducedMotion ? 180 : 3000))
  transition.classList.remove("active")
  delete stage.dataset.cinematic
  transition.hidden = true
  cinematic = false
  schedule()
}

function applyResult(result) {
  save()
  for (const event of result.events ?? []) {
    const tone = event.type === "stellar_explosion" || event.type === "stellar_transition" ? "transition" : "event"
    addEvent(`tick ${event.tick} · ${event.title}`, tone)
    if (event.type === "stellar_explosion") {
      scene.pulse("stellar_explosion")
      void playExplosion()
    }
  }
  const snapshot = controller.snapshot()
  if (snapshot.state.status === "completed") setFeedback("恒星循环完成：复杂物质已经进入稳定行星盘。", "success")
  else setFeedback(`权威状态已推进至 tick ${snapshot.state.tick}。`, "success")
  render()
}

async function mutate(operation) {
  if (!controller || busy || cinematic) return
  busy = true
  render()
  try {
    const result = operation(controller.snapshot())
    applyResult(result)
  } catch (error) {
    setFeedback(`${error.code ?? "stellar_error"}：${error.message}`, "warning")
    addEvent(error.message, "warning")
  } finally {
    busy = false
    render()
    schedule()
  }
}

function schedule() {
  clearTimeout(timer)
  if (!controller || busy) return
  const snapshot = controller.snapshot()
  if (snapshot.control.mode !== "running" || snapshot.state.status !== "running") return
  timer = setTimeout(() => {
    void mutate((current) => controller.pulse({ expectedRevision: current.revision }))
  }, reducedMotion ? 220 : 620)
}

function reset() {
  if (!spec) return
  clearTimeout(timer)
  controller = new StellarController(spec)
  save()
  eventLog.replaceChildren()
  scene.pulse("reset")
  fallback.hidden = scene.supported
  addEvent("原始物质云重新形成。")
  setFeedback("模拟已重置并暂停，可以单步观察或启动自主演化。", "success")
  busy = false
  render()
}

runButton.addEventListener("click", () => {
  void mutate((snapshot) => controller.control(
    snapshot.control.mode === "running" ? "pause" : "resume",
    { expectedRevision: snapshot.revision },
  ))
})
stepButton.addEventListener("click", () => {
  void mutate((snapshot) => controller.control("step", { expectedRevision: snapshot.revision }))
})
advanceButton.addEventListener("click", () => {
  void mutate((snapshot) => controller.advance(10, { expectedRevision: snapshot.revision }))
})
speedButton.addEventListener("click", () => {
  void mutate((snapshot) => {
    const index = SPEEDS.indexOf(snapshot.control.speed)
    return controller.control("set_speed", { speed: SPEEDS[(index + 1) % SPEEDS.length], expectedRevision: snapshot.revision })
  })
})
resetButton.addEventListener("click", reset)

async function start() {
  spec = validateStellarSpec(await fetch("./stellar.json").then((response) => {
    if (!response.ok) throw new Error(`恒星内容包加载失败：HTTP ${response.status}`)
    return response.json()
  }))
  const stored = localStorage.getItem(STORAGE_KEY)
  controller = stored === null ? new StellarController(spec) : StellarController.restore(spec, JSON.parse(stored))
  if (stored === null) save()
  busy = false
  const snapshot = controller.snapshot()
  addEvent(stored === null ? "原始物质云开始聚集。" : `已验证并恢复 tick ${snapshot.state.tick} 的恒星记录。`)
  setFeedback("所有画面均由确定性权威快照派生；可以暂停、单步或选择时间倍率。")
  render()
  schedule()
}

start().catch((error) => {
  clearTimeout(timer)
  controller = undefined
  busy = false
  phaseBadge.textContent = "恒星记录无法恢复"
  objective.textContent = error.message
  setFeedback("记录没有被静默清除；点击“重置恒星”可显式创建新记录。", "warning")
  fallback.hidden = false
  render()
})
