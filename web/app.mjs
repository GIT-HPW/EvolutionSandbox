// SPDX-License-Identifier: GPL-3.0-or-later

import { applyAction, branchTimeline, createState, validatePack } from "./rules-engine.mjs"

const pack = validatePack(await fetch("./origin.json").then((response) => {
  if (!response.ok) throw new Error(`内容包加载失败：HTTP ${response.status}`)
  return response.json()
}))
let state = createState(pack)

const stats = document.querySelector("#stats")
const actions = document.querySelector("#actions")
const badge = document.querySelector("#phase-badge")
const objective = document.querySelector("#objective")
const log = document.querySelector("#log")
const timelinePanel = document.querySelector("#timeline-panel")
const labels = { energy: "能量", information: "信息", entropy: "熵", stability: "稳定", fragments: "碎片" }

function phase() {
  return pack.phases.find((item) => item.id === state.phase)
}

function addLog(message, error = false) {
  const item = document.createElement("li")
  item.textContent = message
  if (error) item.className = "error"
  log.prepend(item)
}

function render() {
  const currentPhase = phase()
  badge.textContent = `${currentPhase.title} · ${state.dimension}D`
  objective.textContent = currentPhase.objective
  stats.replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const item = document.createElement("div")
    item.className = "stat"
    const name = document.createElement("span")
    name.textContent = label
    const value = document.createElement("strong")
    value.textContent = String(state[key])
    item.append(name, value)
    return item
  }))

  actions.replaceChildren(...Object.entries(pack.actions).map(([id, action]) => {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.action = id
    button.disabled = !action.availableIn.includes(state.phase)
    const title = document.createElement("strong")
    title.textContent = action.title
    const detail = document.createElement("small")
    const requirements = Object.entries(action.requires ?? {}).map(([key, value]) => `${labels[key] ?? key}≥${value}`).join(" · ")
    detail.textContent = requirements || action.result
    button.append(title, detail)
    return button
  }))
  timelinePanel.hidden = state.phase !== "first_3d"
}

actions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]")
  if (!button) return
  try {
    const result = applyAction(pack, state, button.dataset.action)
    state = result.state
    addLog(`${result.event.title}：${result.event.result}`)
    if (result.event.transitioned) addLog("阶段跃迁完成：首个三维领域已形成。")
  } catch (error) {
    addLog(error.message, true)
  }
  render()
})

document.querySelector("#reset").addEventListener("click", () => {
  state = createState(pack)
  log.replaceChildren()
  addLog("宇宙已重置到零维原点。")
  render()
})

document.querySelector("#branch").addEventListener("click", () => {
  try {
    state = branchTimeline(state, document.querySelector("#timeline-name").value)
    addLog(`时间线分支已保存：${state.timeline}`)
  } catch (error) {
    addLog(error.message, true)
  }
  render()
})

addLog("原始能量信息体苏醒。先尝试观察混沌。")
render()
