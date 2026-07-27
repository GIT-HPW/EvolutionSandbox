// SPDX-License-Identifier: GPL-3.0-or-later

import { createDirectorApprovalGate } from "../../../src/director/approval.mjs"
import { EsipAdapter } from "../../../src/interop/adapter.mjs"
import { createDirectorAdapter } from "../../../src/interop/director-adapter.mjs"
import { TYPES } from "../../../src/interop/message-types.mjs"
import { MemoryRouter } from "../../../src/interop/router.mjs"
import { startAutoEvolution, updateAutoEvolution } from "./auto-evolution.mjs"
import { originAppReady } from "./app.mjs"

const DIRECTOR_SOURCE = "esip://browser/director-local"
const CONTROL_SOURCE = "esip://browser/director-panel"
const ACTOR_ID = "browser-player"
const UNIVERSE_ID = "universe-1"
const DIRECTOR_RECORD_KEY = "evolution-sandbox.director.record.v1"
const APPROVAL_RECORD_KEY = "evolution-sandbox.director.approval.v1"

const openButton = document.querySelector("#director-open")
const overlay = document.querySelector("#director-overlay")
const closeButton = document.querySelector("#director-close")
const resetButton = document.querySelector("#director-reset")
const form = document.querySelector("#director-goal-form")
const goalInput = document.querySelector("#director-goal")
const submitButton = document.querySelector("#director-submit")
const status = document.querySelector("#director-status")
const ticketView = document.querySelector("#director-ticket")
const ticketType = document.querySelector("#director-ticket-type")
const ticketTitle = document.querySelector("#director-ticket-title")
const ticketState = document.querySelector("#director-ticket-state")
const ticketRationale = document.querySelector("#director-ticket-rationale")
const ticketId = document.querySelector("#director-ticket-id")
const ticketPlan = document.querySelector("#director-ticket-plan")
const ticketAudit = document.querySelector("#director-ticket-audit")
const approveButton = document.querySelector("#director-approve")
const declineButton = document.querySelector("#director-decline")
const fullAutoButton = document.querySelector("#full-auto")
const pending = new Map()

let runtime
let director
let gate
let control
let currentTicket
let panelBusy = false
let presentationBusy = false
let fullAutoRunning = false
let activeAutoRunId
let initialized = false

function setStatus(text, tone = "info") {
  status.textContent = text
  status.dataset.tone = tone
}

function loadRecord(key) {
  const raw = localStorage.getItem(key)
  if (raw === null) return undefined
  try { return JSON.parse(raw) } catch {
    const error = new Error(`本地记录 ${key} 不是有效 JSON`)
    error.code = "invalid_local_record"
    throw error
  }
}

function saveRecord(key, record) {
  localStorage.setItem(key, JSON.stringify(record))
}

function setPanelBusy(value) {
  panelBusy = value
  submitButton.disabled = value || !initialized
  goalInput.disabled = value || !initialized
  closeButton.disabled = value
  resetButton.disabled = value
  const pendingReview = currentTicket?.status === "pending"
  approveButton.disabled = value || presentationBusy || !pendingReview
  declineButton.disabled = value || !pendingReview
  fullAutoButton.disabled = !initialized || (value && !fullAutoRunning)
  fullAutoButton.textContent = fullAutoRunning ? "停止全自动演化" : "全自动演化"
}

function intentLabel(type) {
  return {
    action_suggestion: "行为建议",
    narrative_cue: "叙事提示",
    scene_transition_request: "场景切换申请",
  }[type] ?? type
}

function planLabel(ticket) {
  const plan = ticket.execution?.plan
  if (!plan) {
    if (ticket.intent.type === "action_suggestion") return `待批准行为：${ticket.intent.parameters.actionId}`
    if (ticket.intent.type === "scene_transition_request") {
      return `待批准转场：${ticket.intent.parameters.fromScene} → ${ticket.intent.parameters.toScene}`
    }
    return `待批准叙事：${ticket.intent.parameters.tone}`
  }
  if (plan.type === "action_command") return `行为命令：${plan.actionId} / expected revision ${plan.expectedStateRevision}`
  if (plan.type === "scene_transition_permit") return `场景许可：${plan.fromScene} → ${plan.toScene}（尚未导航）`
  return `叙事发布：${plan.tone}`
}

function renderTicket(ticket) {
  currentTicket = ticket
  ticketView.hidden = false
  ticketType.textContent = intentLabel(ticket.intent.type)
  ticketTitle.textContent = ticket.intent.title
  ticketState.textContent = ticket.status.toUpperCase()
  ticketState.dataset.status = ticket.status
  ticketRationale.textContent = ticket.intent.rationale
  ticketId.textContent = ticket.ticketId
  ticketPlan.textContent = planLabel(ticket)
  ticketAudit.textContent = `${ticket.audit.policyId} / ${ticket.audit.ruleId} / ${ticket.audit.requestHash}`
  setPanelBusy(panelBusy)
}

function responseId(message) {
  if (message.type === TYPES.DIRECTOR_DECIDED || message.type === TYPES.ERROR) return message.data.respondingTo
}

async function requestDirector(goal, context, observation) {
  const id = crypto.randomUUID()
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error("本地导演响应超时"))
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
    await control.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", {
      context,
      goal,
      observation,
      expectedDirectorRevision: director.directorRevision,
    }, {
      id,
      target: DIRECTOR_SOURCE,
      subject: `actor/${ACTOR_ID}`,
    })
  } catch (error) {
    pending.get(id)?.resolve({ type: TYPES.ERROR, data: { respondingTo: id, code: error.code ?? "transport_error", message: error.message } })
  }
  return response
}

async function propose(goal) {
  const context = runtime.context()
  const observation = runtime.observation(["origin", "stellar"])
  setStatus("正在把目标交给本地确定性导演；此阶段不会修改游戏状态……", "pending")
  const message = await requestDirector(goal, context, observation)
  if (message.type === TYPES.ERROR) throw Object.assign(new Error(message.data.message), { code: message.data.code })
  if (message.data.outcome !== "proposed") {
    currentTicket = undefined
    ticketView.hidden = true
    setStatus(`${message.data.reasonCode}：${message.data.explanation}`, "warning")
    return undefined
  }
  const ticket = await gate.stage({
    requestId: message.data.respondingTo,
    context,
    observation,
    decision: message.data,
  })
  renderTicket(ticket)
  setStatus("提案已登记为待审票据。游戏权威仍为零写入，请检查内容后选择批准或拒绝。", "success")
  return ticket
}

async function review(choice, { automatic = false } = {}) {
  if (!currentTicket) return
  setStatus(choice === "approve" ? "正在重新检查权威状态并执行已批准计划……" : "正在记录拒绝结果……", "pending")
  const startedAt = performance.now()
  const reviewed = await gate.review(currentTicket.ticketId, { choice, reviewerId: ACTOR_ID })
  const elapsed = Math.max(0, Math.round(performance.now() - startedAt))
  renderTicket(reviewed)
  if (reviewed.status === "declined") {
    setStatus(`提案已拒绝；没有执行游戏行为（${elapsed} ms）。`, "success")
  } else if (reviewed.execution?.plan.type === "scene_transition_permit") {
    setStatus(`转场许可已经生成（${elapsed} ms），正在暂停场景并写入权威检查点……`, "pending")
    overlay.hidden = true
    runtime.setOverlayOpen(false)
    await runtime.completeSceneTransition(reviewed.execution.plan, {
      permitId: reviewed.ticketId,
      automatic,
    })
  } else if (reviewed.execution?.plan.type === "action_command" && runtime.isBusy()) {
    presentationBusy = true
    setStatus(`权威已确认并完成审批落盘（${elapsed} ms）；领域跃迁动画仍在播放。`, "success")
    setPanelBusy(false)
    void runtime.whenIdle().then(() => {
      presentationBusy = false
      setPanelBusy(false)
      if (currentTicket?.ticketId === reviewed.ticketId) setStatus(`权威确认 ${elapsed} ms；表现动画现已完成。`, "success")
    })
  } else {
    setStatus(`已完成批准计划（${elapsed} ms），画面只呈现浏览器权威确认后的结果。`, "success")
  }
  return reviewed
}

async function runFullAuto() {
  if (fullAutoRunning) {
    runtime.stopFullEvolution()
    setStatus("已请求停止全自动演化；当前权威行为确认后将安全中止。", "warning")
    return
  }
  if (!initialized || panelBusy) return
  activeAutoRunId = `auto-${crypto.randomUUID()}`
  startAutoEvolution({ runId: activeAutoRunId, replace: true })
  fullAutoRunning = true
  setPanelBusy(true)
  try {
    runtime.publishNarrative("全自动自检已经启动：将依次验证原点、物质循环和受控星辰转场。", "discovery")
    const result = await runtime.runFullEvolution()
    if (result.outcome !== "completed") {
      updateAutoEvolution("cancelled", { runId: activeAutoRunId })
      setStatus("全自动演化已停止；已确认状态没有回滚。", "warning")
      return
    }
    const ticket = await propose("让宇宙进入星辰时代")
    if (!ticket || ticket.intent.type !== "scene_transition_request") {
      throw Object.assign(new Error("原点完成后没有生成有效的星辰转场申请"), { code: "auto_transition_unavailable" })
    }
    updateAutoEvolution("transitioning", { runId: activeAutoRunId })
    await review("approve", { automatic: true })
  } catch (error) {
    try { updateAutoEvolution("failed", { runId: activeAutoRunId, error: error.message }) } catch {}
    setStatus(`${error.code ?? "auto_evolution_error"}：${error.message}`, "warning")
  } finally {
    fullAutoRunning = false
    activeAutoRunId = undefined
    setPanelBusy(false)
  }
}

async function initializeDirector() {
  const router = new MemoryRouter({
    authorize: (message) => message.kind === "event" || message.kind === "result"
      || (message.source === CONTROL_SOURCE
        && message.target === DIRECTOR_SOURCE
        && message.type === TYPES.DIRECTOR_GOAL_REQUESTED),
  })
  director = createDirectorAdapter({
    source: DIRECTOR_SOURCE,
    bindings: [{ source: CONTROL_SOURCE, actorId: ACTOR_ID, universeId: UNIVERSE_ID }],
    record: loadRecord(DIRECTOR_RECORD_KEY),
    directorChanged: async (record) => saveRecord(DIRECTOR_RECORD_KEY, record),
  })
  control = new EsipAdapter({
    id: "browser-director-panel",
    source: CONTROL_SOURCE,
    platform: "browser-babylon-director-lab",
    consumes: [TYPES.DIRECTOR_DECIDED, TYPES.ERROR],
    produces: [TYPES.DIRECTOR_GOAL_REQUESTED],
    handle: async (message) => {
      const id = responseId(message)
      if (id) pending.get(id)?.resolve(message)
    },
  })
  gate = createDirectorApprovalGate({
    record: loadRecord(APPROVAL_RECORD_KEY),
    observe: async () => runtime.observation(["origin", "stellar"]),
    executeAction: async (plan) => runtime.executeApprovedAction(plan.actionId),
    publishNarrative: async (plan) => runtime.publishNarrative(plan.cue, plan.tone),
    prepareSceneTransition: async (plan) => ({
      outcome: "permit_prepared",
      fromScene: plan.fromScene,
      toScene: plan.toScene,
      checkpointRequired: true,
      navigationPerformed: false,
    }),
    approvalChanged: async (record) => saveRecord(APPROVAL_RECORD_KEY, record),
  })
  await director.connect(router)
  await control.connect(router)
  initialized = true
  const restored = gate.pendingTickets.at(-1) ?? gate.record.tickets.at(-1)
  if (restored) {
    renderTicket(restored)
    setStatus(restored.status === "pending"
      ? "已恢复一张待审票据；批准前会再次验证当前权威状态。"
      : `已恢复最近票据：${restored.status}。`, "success")
  } else {
    setStatus("本地导演已就绪。输入一句话只会先生成待审提案。", "success")
  }
  setPanelBusy(false)
}

function openPanel() {
  if (!runtime?.canOpenOverlay()) return
  runtime.setOverlayOpen(true)
  overlay.hidden = false
  goalInput.focus()
}

function closePanel() {
  if (panelBusy) return
  overlay.hidden = true
  runtime?.setOverlayOpen(false)
  openButton.focus()
}

openButton.addEventListener("click", openPanel)
closeButton.addEventListener("click", closePanel)
overlay.addEventListener("click", (event) => { if (event.target === overlay) closePanel() })
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) closePanel() })
resetButton.addEventListener("click", () => {
  if (panelBusy) return
  localStorage.removeItem(DIRECTOR_RECORD_KEY)
  localStorage.removeItem(APPROVAL_RECORD_KEY)
  window.location.reload()
})
form.addEventListener("submit", async (event) => {
  event.preventDefault()
  const goal = goalInput.value.trim()
  if (!goal || panelBusy || !initialized) return
  setPanelBusy(true)
  try { await propose(goal) } catch (error) {
    setStatus(`${error.code ?? "director_error"}：${error.message}`, "warning")
  } finally { setPanelBusy(false) }
})
approveButton.addEventListener("click", async () => {
  if (panelBusy || currentTicket?.status !== "pending") return
  setPanelBusy(true)
  try { await review("approve") } catch (error) {
    setStatus(`${error.code ?? "approval_error"}：${error.message}`, "warning")
    if (gate && currentTicket) renderTicket(gate.getTicket(currentTicket.ticketId) ?? currentTicket)
  } finally { setPanelBusy(false) }
})
declineButton.addEventListener("click", async () => {
  if (panelBusy || currentTicket?.status !== "pending") return
  setPanelBusy(true)
  try { await review("decline") } catch (error) {
    setStatus(`${error.code ?? "approval_error"}：${error.message}`, "warning")
  } finally { setPanelBusy(false) }
})
fullAutoButton.addEventListener("click", () => { void runFullAuto() })

setPanelBusy(true)
runtime = await originAppReady
if (!runtime) {
  setStatus("原点权威运行时启动失败，导演面板已停用。", "warning")
} else {
  openButton.disabled = false
  try { await initializeDirector() } catch (error) {
    initialized = false
    setStatus(`${error.code ?? "director_startup_error"}：${error.message}。可使用“重建导演记录”恢复。`, "warning")
    setPanelBusy(false)
  }
}
