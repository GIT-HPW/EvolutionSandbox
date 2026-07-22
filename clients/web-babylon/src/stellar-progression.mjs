// SPDX-License-Identifier: GPL-3.0-or-later

const definitions = [
  { id: "protostar_formed", title: "形成原恒星", detail: "让聚集开始推动新的聚集" },
  { id: "star_ignited", title: "点燃第一束星光", detail: "使核心达到点燃质量和温度" },
  { id: "main_sequence_completed", title: "完成稳定燃烧", detail: "在聚集与释放之间维持动态平衡" },
  { id: "supernova", title: "经历星辰爆发", detail: "打开旧边界并播撒复杂物质" },
  { id: "planetary_disk", title: "形成初生行星盘", detail: "让星辰遗产进入下一代世界" },
]

export function stellarJourney(state) {
  const reached = new Set((state?.milestones ?? []).map((entry) => entry.id))
  const steps = definitions.map((definition) => ({
    ...definition,
    complete: reached.has(definition.id),
  }))
  const completed = steps.filter((step) => step.complete).length
  return {
    complete: state?.status === "completed" && completed === steps.length,
    completed,
    total: steps.length,
    steps,
  }
}
