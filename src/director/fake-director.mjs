// SPDX-License-Identifier: GPL-3.0-or-later

import { hashHex } from "../determinism/prng.mjs"
import { validateDirectorIntent, validateDirectorObservation, validateDirectorPolicy } from "./validation.mjs"

export const DEFAULT_DIRECTOR_POLICY = Object.freeze({
  schemaVersion: 1,
  id: "local-director-v1",
  allowedIntentTypes: Object.freeze(["narrative_cue", "action_suggestion", "scene_transition_request"]),
  allowedActions: Object.freeze(["observe", "split", "fuse", "big_bang", "create", "destroy", "stabilize"]),
  allowedScenes: Object.freeze(["origin", "stellar"]),
  transitions: Object.freeze([
    Object.freeze({ fromScene: "origin", toScene: "stellar", requiredMilestone: "realm_anchored", mode: "manual_confirm" }),
  ]),
})

const SCENE_KEYWORDS = [
  { sceneId: "stellar", terms: ["恒星", "星辰", "星系", "star", "stellar"] },
  { sceneId: "civilization", terms: ["文明", "社会", "civilization", "society"] },
  { sceneId: "origin", terms: ["起源", "原点", "origin"] },
]

const ACTION_KEYWORDS = [
  { actionId: "big_bang", terms: ["大爆炸", "big bang"] },
  { actionId: "stabilize", terms: ["稳定", "稳固", "stabilize"] },
  { actionId: "destroy", terms: ["毁灭", "回收", "destroy"] },
  { actionId: "create", terms: ["创造物质", "生成物质", "create matter"] },
  { actionId: "split", terms: ["撕裂", "碎片", "split"] },
  { actionId: "fuse", terms: ["融合", "聚合", "fuse"] },
  { actionId: "observe", terms: ["观察", "观测", "observe"] },
]

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

function includesTerm(goal, terms) {
  const lowered = goal.toLocaleLowerCase("zh-CN")
  return terms.some((term) => lowered.includes(term.toLocaleLowerCase("zh-CN")))
}

function requestHash(goal, observation, policy) {
  return hashHex(canonicalJson({ goal, observation, policyId: policy.id }))
}

function intentId(hash, ruleId) {
  return `intent-${hash}-${hashHex(ruleId)}`
}

function rejected(hash, policy, ruleId, reasonCode, explanation) {
  return {
    outcome: "rejected",
    intent: null,
    reasonCode,
    explanation,
    audit: { policyId: policy.id, engine: "deterministic_fake", requestHash: hash, ruleId },
  }
}

function proposed(hash, policy, ruleId, intent) {
  return {
    outcome: "proposed",
    intent: validateDirectorIntent({ intentId: intentId(hash, ruleId), ...intent }),
    reasonCode: "intent_proposed",
    explanation: "目标已转换为受限导演意图；权威端尚未执行任何游戏行为。",
    audit: { policyId: policy.id, engine: "deterministic_fake", requestHash: hash, ruleId },
  }
}

export function decideDirectorGoal({ goal, observation, policy = DEFAULT_DIRECTOR_POLICY } = {}) {
  if (typeof goal !== "string" || goal.trim().length < 1 || goal.length > 512) {
    throw new TypeError("goal must contain 1-512 characters")
  }
  const normalizedGoal = goal.trim()
  const safeObservation = validateDirectorObservation(observation)
  const safePolicy = validateDirectorPolicy(policy)
  const hash = requestHash(normalizedGoal, safeObservation, safePolicy)

  if (!safePolicy.allowedScenes.includes(safeObservation.sceneId)) {
    return rejected(hash, safePolicy, `scene:${safeObservation.sceneId}`, "scene_forbidden", "当前场景不在导演策略的允许范围内。")
  }

  const sceneMatch = SCENE_KEYWORDS.find((candidate) => includesTerm(normalizedGoal, candidate.terms))
  if (sceneMatch && sceneMatch.sceneId !== safeObservation.sceneId) {
    const ruleId = `scene:${safeObservation.sceneId}->${sceneMatch.sceneId}`
    if (!safePolicy.allowedIntentTypes.includes("scene_transition_request")) {
      return rejected(hash, safePolicy, ruleId, "intent_type_forbidden", "当前导演策略不允许提出场景切换申请。")
    }
    if (!safePolicy.allowedScenes.includes(sceneMatch.sceneId) || !safeObservation.availableScenes.includes(sceneMatch.sceneId)) {
      return rejected(hash, safePolicy, ruleId, "scene_unavailable", `场景 ${sceneMatch.sceneId} 未在当前构建与策略中开放。`)
    }
    const transition = safePolicy.transitions.find((candidate) => (
      candidate.fromScene === safeObservation.sceneId && candidate.toScene === sceneMatch.sceneId
    ))
    if (!transition) return rejected(hash, safePolicy, ruleId, "transition_forbidden", "当前导演策略没有授权这条场景路径。")
    if (!safeObservation.completedMilestones.includes(transition.requiredMilestone)) {
      return rejected(hash, safePolicy, ruleId, "milestone_required", `场景切换仍需要里程碑 ${transition.requiredMilestone}。`)
    }
    return proposed(hash, safePolicy, ruleId, {
      type: "scene_transition_request",
      title: `申请进入 ${sceneMatch.sceneId} 场景`,
      rationale: "目标指向新的宏观演化纪元，且当前权威观察已经满足转场前置条件。",
      parameters: structuredClone(transition),
    })
  }

  const actionMatch = ACTION_KEYWORDS.find((candidate) => includesTerm(normalizedGoal, candidate.terms))
  if (actionMatch) {
    const ruleId = `action:${actionMatch.actionId}`
    if (!safePolicy.allowedIntentTypes.includes("action_suggestion")) {
      return rejected(hash, safePolicy, ruleId, "intent_type_forbidden", "当前导演策略不允许提出行为建议。")
    }
    if (!safePolicy.allowedActions.includes(actionMatch.actionId) || !safeObservation.availableActions.includes(actionMatch.actionId)) {
      return rejected(hash, safePolicy, ruleId, "action_unavailable", `行为 ${actionMatch.actionId} 在当前权威状态下不可用。`)
    }
    return proposed(hash, safePolicy, ruleId, {
      type: "action_suggestion",
      title: `建议行为：${actionMatch.actionId}`,
      rationale: "目标与当前已开放行为相匹配；该建议仍需由游戏权威端确认。",
      parameters: { actionId: actionMatch.actionId },
    })
  }

  const ruleId = "narrative:fallback"
  if (!safePolicy.allowedIntentTypes.includes("narrative_cue")) {
    return rejected(hash, safePolicy, ruleId, "no_allowed_intent", "目标没有映射到当前策略允许的导演意图。")
  }
  return proposed(hash, safePolicy, ruleId, {
    type: "narrative_cue",
    title: "导演观察提示",
    rationale: "目标尚未指向可以安全执行的行为，先以叙事提示保留玩家意图。",
    parameters: {
      cue: `世界正在记录“${normalizedGoal.slice(0, 120)}”，等待更多可验证的演化条件。`,
      tone: "discovery",
    },
  })
}
