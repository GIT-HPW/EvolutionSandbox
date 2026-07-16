// SPDX-License-Identifier: GPL-3.0-or-later

export class RuleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "RuleError"
    this.code = code
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function validatePack(pack) {
  if (!isPlainObject(pack) || pack.schemaVersion !== 1) throw new Error("Unsupported content schema")
  if (!isPlainObject(pack.initialState) || !isPlainObject(pack.actions) || !isPlainObject(pack.limits)) {
    throw new Error("Content pack is missing state, actions, or limits")
  }
  if (!Array.isArray(pack.phases) || pack.phases.length === 0) throw new Error("At least one phase is required")

  const phaseIds = new Set(pack.phases.map((phase) => phase.id))
  if (phaseIds.size !== pack.phases.length || !phaseIds.has(pack.initialState.phase)) {
    throw new Error("Phase ids must be unique and include the initial phase")
  }

  for (const [name, action] of Object.entries(pack.actions)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`Invalid action id: ${name}`)
    if (!Array.isArray(action.availableIn) || action.availableIn.some((phase) => !phaseIds.has(phase))) {
      throw new Error(`Action ${name} references an unknown phase`)
    }
    for (const field of ["requires", "delta"]) {
      for (const [stat, value] of Object.entries(action[field] ?? {})) {
        if (!(stat in pack.initialState) || typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`Action ${name} has invalid ${field}.${stat}`)
        }
      }
    }
    if (action.set?.phase && !phaseIds.has(action.set.phase)) throw new Error(`Action ${name} sets an unknown phase`)
  }

  if (!Array.isArray(pack.demo) || pack.demo.some((name) => !(name in pack.actions))) {
    throw new Error("Demo contains an unknown action")
  }
  return pack
}

export function createState(pack) {
  validatePack(pack)
  return structuredClone(pack.initialState)
}

function clamp(pack, stat, value) {
  const limit = pack.limits[stat]
  if (!limit || typeof value !== "number") return value
  return Math.max(limit.min, Math.min(limit.max, value))
}

export function applyAction(pack, currentState, actionName) {
  validatePack(pack)
  const action = pack.actions[actionName]
  if (!action) throw new RuleError("unknown_action", `未知行为：${actionName}`)
  if (!action.availableIn.includes(currentState.phase)) {
    throw new RuleError("wrong_phase", `“${action.title}”不能在当前阶段执行`)
  }
  for (const [stat, required] of Object.entries(action.requires ?? {})) {
    if ((currentState[stat] ?? 0) < required) {
      throw new RuleError("requirement", `${stat} 需要至少 ${required}，当前为 ${currentState[stat] ?? 0}`)
    }
  }

  const state = structuredClone(currentState)
  for (const [stat, delta] of Object.entries(action.delta ?? {})) {
    state[stat] = clamp(pack, stat, (state[stat] ?? 0) + delta)
  }
  for (const [key, value] of Object.entries(action.set ?? {})) state[key] = value
  state.steps = clamp(pack, "steps", (state.steps ?? 0) + 1)

  return {
    state,
    event: {
      action: actionName,
      title: action.title,
      result: action.result,
      transitioned: state.phase !== currentState.phase,
      fromPhase: currentState.phase,
      toPhase: state.phase
    }
  }
}

export function branchTimeline(currentState, name) {
  if (currentState.phase !== "first_3d") throw new RuleError("wrong_phase", "进入三维领域后才能创建时间线")
  const branch = name.trim()
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(branch)) {
    throw new RuleError("invalid_branch", "时间线名称只能包含字母、数字、下划线或连字符，最长 32 个字符")
  }
  return { ...currentState, timeline: branch }
}

export function statusLine(state) {
  return `阶段=${state.phase} 维度=${state.dimension} 能量=${state.energy} 信息=${state.information} 熵=${state.entropy} 稳定=${state.stability} 碎片=${state.fragments} 时间线=${state.timeline}`
}
