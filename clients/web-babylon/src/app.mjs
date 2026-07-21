// SPDX-License-Identifier: GPL-3.0-or-later

import { validatePack } from "../../../src/rules-engine.mjs"
import { EsipAdapter } from "../../../src/interop/adapter.mjs"
import { createBrowserEvolutionAdapter, DEFAULT_BROWSER_STORAGE_KEY } from "../../../src/interop/browser-game-adapter.mjs"
import { TYPES } from "../../../src/interop/message-types.mjs"
import { MemoryRouter } from "../../../src/interop/router.mjs"
import { playActionSound } from "./audio.mjs"
import { createAnimeUniverse } from "./scene.mjs"

const GAME_SOURCE = "esip://browser/sandbox"
const CONTROL_SOURCE = "esip://browser/control"
const ACTOR_ID = "browser-player"
const UNIVERSE_ID = "universe-1"
const CONTROL_SEQUENCE_KEY = `${DEFAULT_BROWSER_STORAGE_KEY}.controlSequence`
const labels = { energy: "能量", information: "信息", entropy: "熵", stability: "稳定", fragments: "碎片" }
const scales = { energy: 40, information: 18, entropy: 20, stability: 24, fragments: 8 }

const pack = validatePack(await fetch("./origin.json").then((response) => {
  if (!response.ok) throw new Error(`内容包加载失败：HTTP ${response.status}`)
  return response.json()
}))

const canvas = document.querySelector("#render-canvas")
const scene = createAnimeUniverse(canvas, {
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
})
const phaseBadge = document.querySelector("#phase-badge")
const objective = document.querySelector("#objective")
const stats = document.querySelector("#stats")
const actions = document.querySelector("#actions")
const feedback = document.querySelector("#feedback")
const eventLog = document.querySelector("#event-log")
const resetButton = document.querySelector("#reset")
const autoButton = document.querySelector("#auto-demo")
const fallback = document.querySelector("#render-fallback")
const pending = new Map()

let state
let revision = 0
let busy = true
let autoRunning = false
let game
let control

if (!scene.supported) fallback.hidden = false

function phase() {
  return pack.phases.find((item) => item.id === state?.phase)
}

function context() {
  const current = state ?? game.stateSnapshot
  return {
    universeId: UNIVERSE_ID,
    timelineId: current.timeline,
    realmId: current.phase,
    actorId: ACTOR_ID,
  }
}

function responseId(message) {
  if (message.type === TYPES.ACTION_APPLIED) return message.data.commandId
  if (message.type === TYPES.STATE_SNAPSHOT || message.type === TYPES.ERROR) return message.data.respondingTo
}

function addEvent(text, tone = "event") {
  const item = document.createElement("li")
  item.textContent = text
  item.dataset.tone = tone
  eventLog.prepend(item)
  while (eventLog.children.length > 7) eventLog.lastElementChild.remove()
}

function setFeedback(text, tone = "info") {
  feedback.textContent = text
  feedback.dataset.tone = tone
}

function requirementText(action) {
  return Object.entries(action.requires ?? {})
    .map(([key, value]) => `${labels[key] ?? key}≥${value}`)
    .join(" · ")
}

function render() {
  const currentPhase = phase()
  if (!state || !currentPhase) return
  phaseBadge.textContent = `${currentPhase.title} · ${state.dimension}D · revision ${revision}`
  objective.textContent = currentPhase.objective
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

  actions.replaceChildren(...Object.entries(pack.actions).map(([id, action]) => {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.action = id
    const available = action.availableIn.includes(state.phase)
    button.disabled = busy || autoRunning
    button.classList.toggle("locked", !available)
    button.setAttribute("aria-disabled", String(!available))
    const name = document.createElement("strong")
    name.textContent = action.title
    const detail = document.createElement("small")
    detail.textContent = available ? (requirementText(action) || action.result) : "当前维度不可用"
    button.append(name, detail)
    return button
  }))
  resetButton.disabled = busy || autoRunning
  autoButton.disabled = busy || autoRunning
  scene.setState(state)
}

async function request(type, kind, data) {
  const id = crypto.randomUUID()
  const result = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error("ESIP 响应超时"))
    }, 5000)
    pending.set(id, {
      resolve(message) {
        clearTimeout(timeout)
        pending.delete(id)
        resolve(message)
      },
    })
  })
  try {
    await control.emit(type, kind, data, { id, target: GAME_SOURCE, subject: `actor/${ACTOR_ID}` })
  } catch (error) {
    pending.get(id)?.resolve({ type: TYPES.ERROR, data: { code: error.code ?? "transport_error", message: error.message } })
  }
  return result
}

async function performAction(actionId, { quiet = false } = {}) {
  const action = pack.actions[actionId]
  if (!action.availableIn.includes(state.phase)) {
    setFeedback(`${action.title}在当前维度不可执行。`, "warning")
    return false
  }
  busy = true
  setFeedback(`${action.title}：等待权威状态确认……`, "pending")
  render()
  try {
    const message = await request(TYPES.ACTION_REQUESTED, "command", {
      context: context(), actionId, parameters: {}, expectedRevision: revision,
    })
    if (message.type === TYPES.ERROR) {
      setFeedback(`${message.data.code}：${message.data.message}`, "warning")
      if (!quiet) addEvent(message.data.message, "warning")
      return false
    }
    state = message.data.state
    revision = message.data.revision
    scene.pulse(actionId)
    playActionSound(actionId)
    setFeedback(`${action.title}：${action.result}`, "success")
    addEvent(`${action.title} · ${action.result}`)
    return true
  } catch (error) {
    setFeedback(error.message, "warning")
    addEvent(error.message, "warning")
    return false
  } finally {
    busy = false
    render()
  }
}

function resetLocal() {
  const reset = game.resetLocalState()
  state = reset.state
  revision = reset.revision
  eventLog.replaceChildren()
  scene.pulse("reset")
  setFeedback("本地宇宙已重开，可以从观察混沌开始。", "success")
  addEvent("零维原点重新形成。")
  render()
}

function readControlSequence() {
  const value = Number(localStorage.getItem(CONTROL_SEQUENCE_KEY) ?? 0)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("浏览器控制序列记录损坏")
  return value
}

async function start() {
  const router = new MemoryRouter({
    authorize: (message) => message.kind === "event" || message.kind === "result"
      || (message.source === CONTROL_SOURCE && message.target === GAME_SOURCE),
  })
  game = createBrowserEvolutionAdapter({ pack, storage: localStorage })
  control = new EsipAdapter({
    id: "browser-control",
    source: CONTROL_SOURCE,
    platform: "browser-babylon-ui",
    consumes: [TYPES.ACTION_APPLIED, TYPES.STATE_SNAPSHOT, TYPES.REALM_TRANSITIONED, TYPES.ERROR],
    produces: [TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED],
    initialSequence: readControlSequence(),
    sequenceChanged: (next) => localStorage.setItem(CONTROL_SEQUENCE_KEY, String(next)),
    handle: async (message) => {
      if (message.type === TYPES.REALM_TRANSITIONED) {
        addEvent(`维度跃迁 · ${message.data.fromRealm} → ${message.data.toRealm}`, "transition")
      }
      const id = responseId(message)
      if (id) pending.get(id)?.resolve(message)
    },
  })
  await game.connect(router)
  await control.connect(router)
  const snapshot = await request(TYPES.STATE_REQUESTED, "query", {
    context: context(),
    fields: ["phase", "dimension", "energy", "information", "entropy", "stability", "fragments", "timeline", "steps"],
  })
  if (snapshot.type === TYPES.ERROR) throw new Error(snapshot.data.message)
  state = snapshot.data.state
  revision = snapshot.data.revision
  busy = false
  addEvent(revision === 0 ? "原始能量信息体苏醒。" : `已恢复本地宇宙 revision ${revision}。`)
  setFeedback("拖动场景调整视角，滚轮缩放；所有行为均由 ESIP 权威端确认。")
  render()
}

actions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]")
  if (!button || busy || autoRunning) return
  performAction(button.dataset.action)
})

resetButton.addEventListener("click", () => {
  if (!busy && !autoRunning) resetLocal()
})

autoButton.addEventListener("click", async () => {
  if (busy || autoRunning) return
  autoRunning = true
  if (state.phase !== "origin_0d" || state.steps !== 0) resetLocal()
  render()
  setFeedback("自动演化正在执行：观察 → 撕裂 → 大爆炸", "pending")
  for (const actionId of pack.demo) {
    const completed = await performAction(actionId, { quiet: true })
    if (!completed) break
    await new Promise((resolve) => setTimeout(resolve, matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 720))
  }
  autoRunning = false
  render()
})

start().catch((error) => {
  busy = true
  phaseBadge.textContent = "启动失败"
  objective.textContent = error.message
  setFeedback("请检查浏览器 WebGL 和本地存储权限。", "warning")
  fallback.hidden = false
})
