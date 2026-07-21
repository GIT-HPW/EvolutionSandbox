// SPDX-License-Identifier: GPL-3.0-or-later

const definitions = [
  { id: "create", title: "凝聚原始物质", field: "matterCreated", detail: "把能量转化为首份可塑物质" },
  { id: "stabilize", title: "稳定局部时空", field: "matterStabilized", detail: "让物质获得可持续结构" },
  { id: "destroy", title: "完成物质回收", field: "matterRecycled", detail: "验证物质能够安全回归能量" },
]

export function firstRealmMission(state) {
  const active = state?.phase === "first_3d"
  const steps = definitions.map((definition) => ({
    id: definition.id,
    title: definition.title,
    detail: definition.detail,
    complete: active && Number.isSafeInteger(state?.[definition.field]) && state[definition.field] > 0,
  }))
  const completed = steps.filter((step) => step.complete).length
  return {
    active,
    complete: active && completed === steps.length,
    completed,
    total: steps.length,
    steps,
  }
}
