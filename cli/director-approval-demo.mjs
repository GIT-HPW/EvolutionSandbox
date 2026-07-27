// SPDX-License-Identifier: GPL-3.0-or-later

import { createDirectorApprovalGate, decideDirectorGoal } from "../src/director/index.mjs"
import { loadOriginPack } from "../src/load-pack.mjs"
import { applyAction, createState } from "../src/rules-engine.mjs"

const flags = new Set(process.argv.slice(2).filter((argument) => argument.startsWith("--")))
const goal = process.argv.slice(2).filter((argument) => !argument.startsWith("--")).join(" ").trim() || "继续观察这个新生宇宙"
if (flags.has("--approve") && flags.has("--decline")) throw new Error("--approve 和 --decline 不能同时使用")
for (const flag of flags) if (!["--approve", "--decline"].includes(flag)) throw new Error(`未知参数：${flag}`)

const pack = await loadOriginPack()
let state = createState(pack)
let stateRevision = 0
let authorityWrites = 0
let narrativePublishes = 0
let transitionPermits = 0

function availableActions() {
  return Object.entries(pack.actions)
    .filter(([, action]) => action.availableIn.includes(state.phase)
      && Object.entries(action.requires ?? {}).every(([key, value]) => (state[key] ?? 0) >= value))
    .map(([actionId]) => actionId)
}

function completedMilestones() {
  return state.matterCreated > 0 && state.matterStabilized > 0 && state.matterRecycled > 0
    ? ["realm_anchored"]
    : []
}

function observe() {
  return {
    sceneId: "origin",
    phase: state.phase,
    stateRevision,
    availableActions: availableActions(),
    completedMilestones: completedMilestones(),
    availableScenes: ["origin", "stellar"],
  }
}

function context() {
  return {
    universeId: "universe-1",
    timelineId: state.timeline,
    realmId: state.phase,
    actorId: "director-player",
  }
}

const requestId = "local-approval-demo-1"
const initialObservation = observe()
const initialContext = context()
const result = decideDirectorGoal({ goal, observation: initialObservation })

console.log("本地导演审批演示（不连接网络；未明确批准时游戏权威零写入）")
console.log(`目标：${goal}`)
console.log(`导演结果：${result.outcome} / ${result.reasonCode}`)
if (result.outcome !== "proposed") {
  console.log(`拒绝原因：${result.explanation}`)
  console.log("完成：没有生成审批票据，游戏权威状态写入次数为 0。")
  process.exit(0)
}

const gate = createDirectorApprovalGate({
  observe: async () => observe(),
  executeAction: async (plan) => {
    if (plan.context.actorId !== "director-player" || plan.context.universeId !== "universe-1") {
      const error = new Error("执行计划身份与本地权威不匹配")
      error.code = "identity_mismatch"
      throw error
    }
    if (plan.expectedStateRevision !== stateRevision) {
      const error = new Error(`预期状态 revision ${plan.expectedStateRevision}，当前为 ${stateRevision}`)
      error.code = "revision_conflict"
      throw error
    }
    const applied = applyAction(pack, state, plan.actionId)
    state = applied.state
    stateRevision += 1
    authorityWrites += 1
    return { outcome: "applied", actionId: plan.actionId, authorityRevision: stateRevision, phase: state.phase }
  },
  publishNarrative: async (plan) => {
    narrativePublishes += 1
    return { outcome: "published", tone: plan.tone, gameStateChanged: false }
  },
  prepareSceneTransition: async (plan) => {
    transitionPermits += 1
    return {
      outcome: "permit_prepared",
      fromScene: plan.fromScene,
      toScene: plan.toScene,
      checkpointRequired: true,
      navigationPerformed: false,
    }
  },
})

const ticket = await gate.stage({
  requestId,
  context: initialContext,
  observation: initialObservation,
  decision: {
    context: initialContext,
    respondingTo: requestId,
    revision: 1,
    ...result,
  },
})

console.log(`待审票据：${ticket.ticketId}`)
console.log(`意图：${ticket.intent.type} / ${ticket.intent.title}`)
console.log(`状态：${ticket.status} / 审批 revision ${gate.revision}`)

if (!flags.has("--approve") && !flags.has("--decline")) {
  console.log("未提供 --approve 或 --decline：票据保持待审，未执行任何权威行为。")
} else {
  const choice = flags.has("--approve") ? "approve" : "decline"
  const reviewed = await gate.review(ticket.ticketId, { choice, reviewerId: "director-player" })
  console.log(`人工选择：${choice}`)
  console.log(`最终状态：${reviewed.status} / 审批 revision ${gate.revision}`)
  if (reviewed.execution) console.log(`执行计划：${reviewed.execution.plan.type}`)
}

console.log(`游戏权威状态写入：${authorityWrites}`)
console.log(`叙事发布：${narrativePublishes}`)
console.log(`场景许可：${transitionPermits}（许可不会自动切换页面）`)
