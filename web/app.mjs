// SPDX-License-Identifier: GPL-3.0-or-later

import { validatePack } from "./rules-engine.mjs"
import { EsipAdapter } from "./interop/adapter.mjs"
import { createBrowserEvolutionAdapter, DEFAULT_BROWSER_STORAGE_KEY } from "./interop/browser-game-adapter.mjs"
import { TYPES } from "./interop/message-types.mjs"
import { MemoryRouter } from "./interop/router.mjs"
import { createEvolutionScene } from "./scene.mjs"

const GAME_SOURCE = "esip://browser/sandbox"
const CONTROL_SOURCE = "esip://browser/control"
const ACTOR_ID = "browser-player"
const UNIVERSE_ID = "universe-1"
const CONTROL_SEQUENCE_KEY = `${DEFAULT_BROWSER_STORAGE_KEY}.controlSequence`

const pack = validatePack(await fetch("./origin.json").then((response) => {
  if (!response.ok) throw new Error(`内容包加载失败：HTTP ${response.status}`)
  return response.json()
}))

const stats = document.querySelector("#stats")
const actions = document.querySelector("#actions")
const badge = document.querySelector("#phase-badge")
const objective = document.querySelector("#objective")
const log = document.querySelector("#log")
const timelinePanel = document.querySelector("#timeline-panel")
const actionFeedback = document.querySelector("#action-feedback")
const narrativeStream = document.querySelector("#narrative-stream")
const scene = createEvolutionScene(document.querySelector("#universe-scene"), {
  statusElement: document.querySelector("#scene-status"),
  captionElement: document.querySelector("#scene-caption"),
})
const labels = { energy: "能量", information: "信息", entropy: "熵", stability: "稳定", fragments: "碎片", matter: "物质" }
const statScales = { energy: 36, information: 18, entropy: 20, stability: 24, fragments: 8 }
const pending = new Map()
let state
let revision = 0
let registryRevision = 0
let registryTimelines = []
let narrativeSequence = Number(narrativeStream.lastElementChild?.dataset.sequence ?? 0)
let busy = true
let game
let control

function phase() {
  return pack.phases.find((item) => item.id === state?.phase)
}

function addLog(message, error = false) {
  const item = document.createElement("li")
  item.textContent = message
  if (error) item.className = "error"
  log.prepend(item)
}

function addNarrative(message, tone = "event") {
  narrativeSequence += 1
  const item = document.createElement("li")
  item.dataset.sequence = String(narrativeSequence).padStart(3, "0")
  if (tone !== "event") item.dataset.tone = tone
  item.textContent = message
  narrativeStream.append(item)
  while (narrativeStream.children.length > 6) narrativeStream.firstElementChild.remove()
}

function resetNarrative() {
  narrativeStream.replaceChildren()
  narrativeSequence = -1
  addNarrative("你是零维混沌体中的原始能量信息体。每一次观察、撕裂与融合，都会在实时宇宙中留下痕迹。")
}

function setActionFeedback(message, tone = "info") {
  actionFeedback.textContent = message
  actionFeedback.dataset.tone = tone
}

function missingRequirementText(action) {
  return Object.entries(action.requires ?? {})
    .filter(([key, required]) => (state[key] ?? 0) < required)
    .map(([key, required]) => (labels[key] ?? key) + " " + (state[key] ?? 0) + "/" + required)
    .join(" · ")
}

function phaseLockText(action, { compact = false } = {}) {
  if (state.phase === "origin_0d" && action.availableIn.includes("first_3d")) {
    return compact ? "进入首个三维领域后解锁" : "请先触发大爆炸进入首个三维领域。"
  }
  return compact ? "仅在零维原点阶段可用" : "当前已进入三维领域，此行为只在零维原点阶段可用。"
}

function render() {
  const currentPhase = phase()
  if (!state || !currentPhase) {
    badge.textContent = "载入中"
    objective.textContent = "正在连接浏览器 ESIP 权威适配器……"
    actions.replaceChildren()
    return
  }
  badge.textContent = `${currentPhase.title} · ${state.dimension}D · r${revision} / tr${registryRevision}`
  objective.textContent = currentPhase.objective
  stats.replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const item = document.createElement("div")
    item.className = "stat"
    const name = document.createElement("span")
    name.textContent = label
    const value = document.createElement("strong")
    value.textContent = String(state[key])
    const meter = document.createElement("progress")
    meter.className = "stat-meter"
    meter.max = 1
    meter.value = Math.min(1, state[key] / statScales[key])
    meter.setAttribute("aria-label", label + "相对强度")
    item.append(name, value, meter)
    return item
  }))

  actions.replaceChildren(...Object.entries(pack.actions).map(([id, action]) => {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.action = id
    const phaseAvailable = action.availableIn.includes(state.phase)
    button.disabled = busy
    button.dataset.locked = phaseAvailable ? "" : "phase"
    button.classList.toggle("locked", !phaseAvailable)
    button.setAttribute("aria-disabled", String(!phaseAvailable))
    const title = document.createElement("strong")
    title.textContent = action.title
    const detail = document.createElement("small")
    const requirements = Object.entries(action.requires ?? {}).map(([key, value]) => `${labels[key] ?? key}≥${value}`).join(" · ")
    detail.textContent = phaseAvailable ? (requirements || action.result) : phaseLockText(action, { compact: true })
    button.append(title, detail)
    return button
  }))
  timelinePanel.hidden = state.phase !== "first_3d"
  document.querySelector("#branch").disabled = busy
  document.querySelector("#join").disabled = busy
  document.querySelector("#reset").disabled = busy
  const options = document.querySelector("#timeline-options")
  options.replaceChildren(...registryTimelines.map((entry) => {
    const option = document.createElement("option")
    option.value = entry.timelineId
    return option
  }))
  scene.setState(state, currentPhase)
}

function responseId(message) {
  if (message.type === TYPES.ACTION_APPLIED) return message.data.commandId
  if (message.type === TYPES.TIMELINE_CREATED_V2 || message.type === TYPES.TIMELINE_JOINED) return message.data.commandId
  if (message.type === TYPES.STATE_SNAPSHOT || message.type === TYPES.TIMELINE_REGISTRY_SNAPSHOT || message.type === TYPES.ERROR) return message.data.respondingTo
}

function currentContext() {
  const current = state ?? game.stateSnapshot
  return {
    universeId: UNIVERSE_ID,
    timelineId: current.timeline,
    realmId: current.phase,
    actorId: ACTOR_ID,
  }
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
    const waiting = pending.get(id)
    pending.delete(id)
    waiting?.resolve({ type: TYPES.ERROR, data: { code: error.code ?? "transport_error", message: error.message } })
  }
  return result
}

async function applyRequestedAction(actionId, parameters = {}) {
  const action = pack.actions[actionId]
  setActionFeedback((action?.title ?? actionId) + "：正在等待权威端确认……", "pending")
  busy = true
  render()
  try {
    const message = await request(TYPES.ACTION_REQUESTED, "command", {
      context: currentContext(),
      actionId,
      parameters,
      expectedRevision: revision,
    })
    if (message.type === TYPES.ERROR) {
      const missing = action ? missingRequirementText(action) : ""
      const explanation = message.data.code === "requirement" && missing
        ? action.title + "条件不足：" + missing
        : message.data.code + "：" + message.data.message
      setActionFeedback(explanation, "error")
      addLog(explanation, true)
      addNarrative(explanation, "warning")
      return
    }
    state = message.data.state
    revision = message.data.revision
    scene.pulse(actionId)
    const confirmation = action ? action.title + "：" + action.result : "行为已确认。"
    setActionFeedback(confirmation, "success")
    addLog(confirmation)
    addNarrative(confirmation)
  } catch (error) {
    setActionFeedback(error.message, "error")
    addLog(error.message, true)
    addNarrative(error.message, "warning")
  } finally {
    busy = false
    render()
  }
}

async function refreshRegistry(afterRevision = 0) {
  const message = await request(TYPES.TIMELINE_REGISTRY_REQUESTED, "query", {
    context: currentContext(),
    afterRevision,
  })
  if (message.type === TYPES.ERROR) throw new Error(`${message.data.code}：${message.data.message}`)
  registryRevision = message.data.registryRevision
  registryTimelines = message.data.timelines
  return message
}

async function changeTimeline(kind, timelineId) {
  busy = true
  render()
  try {
    const creating = kind === "create"
    const message = await request(
      creating ? TYPES.TIMELINE_CREATE_REQUESTED : TYPES.TIMELINE_JOIN_REQUESTED,
      "command",
      {
        context: currentContext(),
        ...(creating ? { newTimelineId: timelineId } : { targetTimelineId: timelineId }),
        expectedStateRevision: revision,
        expectedRegistryRevision: registryRevision,
      },
    )
    if (message.type === TYPES.ERROR) {
      addLog(`${message.data.code}：${message.data.message}`, true)
      addNarrative(message.data.message, "warning")
      return
    }
    state = { ...state, timeline: message.data.context.timelineId }
    revision = message.data.stateRevision
    registryRevision = message.data.registryRevision
    scene.pulse(creating ? "timeline_create" : "timeline_join")
    const timelineMessage = creating ? "世界时间线已创建：" + state.timeline : "已加入世界时间线：" + state.timeline
    addLog(timelineMessage)
    addNarrative(timelineMessage)
    await refreshRegistry(Math.max(0, registryRevision - 1))
  } catch (error) {
    addLog(error.message, true)
    addNarrative(error.message, "warning")
  } finally {
    busy = false
    render()
  }
}

function readControlSequence() {
  const raw = localStorage.getItem(CONTROL_SEQUENCE_KEY)
  if (raw === null) return 0
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("浏览器控制适配器序列记录损坏")
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
    platform: "browser-ui",
    consumes: [
      TYPES.ACTION_APPLIED,
      TYPES.STATE_SNAPSHOT,
      TYPES.REALM_TRANSITIONED,
      TYPES.TIMELINE_CREATED_V2,
      TYPES.TIMELINE_JOINED,
      TYPES.TIMELINE_REGISTRY_SNAPSHOT,
      TYPES.ERROR,
    ],
    produces: [
      TYPES.ACTION_REQUESTED,
      TYPES.STATE_REQUESTED,
      TYPES.TIMELINE_CREATE_REQUESTED,
      TYPES.TIMELINE_JOIN_REQUESTED,
      TYPES.TIMELINE_REGISTRY_REQUESTED,
    ],
    initialSequence: readControlSequence(),
    sequenceChanged: (nextSequence) => localStorage.setItem(CONTROL_SEQUENCE_KEY, String(nextSequence)),
    handle: async (message) => {
      if (message.type === TYPES.REALM_TRANSITIONED) {
        const transitionMessage = "阶段跃迁完成：" + message.data.fromRealm + " → " + message.data.toRealm
        addLog(transitionMessage)
        addNarrative(transitionMessage)
      }
      if (message.type === TYPES.TIMELINE_CREATED_V2) addLog(`时间线注册事件已确认：${message.data.newTimelineId}`)
      if (message.type === TYPES.TIMELINE_JOINED) addLog(`时间线加入事件已确认：${message.data.toTimelineId}`)
      const id = responseId(message)
      if (id) pending.get(id)?.resolve(message)
    },
  })
  await game.connect(router)
  await control.connect(router)
  const snapshot = await request(TYPES.STATE_REQUESTED, "query", {
    context: currentContext(),
    fields: ["phase", "dimension", "energy", "information", "entropy", "stability", "fragments", "matter", "matterCreated", "matterStabilized", "matterRecycled", "timeline", "steps"],
  })
  if (snapshot.type === TYPES.ERROR) throw new Error(`${snapshot.data.code}：${snapshot.data.message}`)
  state = snapshot.data.state
  revision = snapshot.data.revision
  await refreshRegistry(0)
  busy = false
  addLog(revision === 0 ? "原始能量信息体苏醒。先尝试观察混沌。" : `已从浏览器本地存档恢复 revision ${revision}。`)
  if (revision > 0) addNarrative("已恢复本地宇宙记录，当前状态 revision " + revision + "。")
  render()
}

actions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]")
  if (!button || busy) return
  if (button.dataset.locked === "phase") {
    const action = pack.actions[button.dataset.action]
    const message = "“" + action.title + "”当前不可执行：" + phaseLockText(action)
    setActionFeedback(message, "error")
    addLog(message, true)
    addNarrative(message, "warning")
    return
  }
  applyRequestedAction(button.dataset.action)
})

document.querySelector("#reset").addEventListener("click", () => {
  if (!game || busy) return
  const reset = game.resetLocalState()
  state = reset.state
  revision = reset.revision
  log.replaceChildren()
  resetNarrative()
  addLog("浏览器本地宇宙已重开；revision 保持单调递增。")
  addNarrative("本地宇宙已重开。所有观测将从零维原点重新开始。")
  setActionFeedback("本地宇宙已重开，可以从“观察混沌”重新开始。", "success")
  scene.pulse("reset")
  render()
})

document.querySelector("#branch").addEventListener("click", () => {
  if (!busy) changeTimeline("create", document.querySelector("#timeline-name").value)
})

document.querySelector("#join").addEventListener("click", () => {
  if (!busy) changeTimeline("join", document.querySelector("#timeline-name").value)
})

render()
start().catch((error) => {
  busy = true
  addLog(`启动失败：${error.message}`, true)
  badge.textContent = "连接失败"
  objective.textContent = "请检查浏览器是否允许此站点使用本地存储。"
})
