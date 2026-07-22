// SPDX-License-Identifier: GPL-3.0-or-later

export const STELLAR_DISPLAY_METRICS = Object.freeze({
  nebulaMass: Object.freeze({ label: "星云质量", unit: "M☉" }),
  stellarMass: Object.freeze({ label: "星体质量", unit: "M☉" }),
  corePressure: Object.freeze({ label: "核心压力", unit: "PPa" }),
  temperature: Object.freeze({ label: "核心温度", unit: "MK" }),
  angularMomentum: Object.freeze({ label: "角动量指数", unit: "%" }),
  luminosity: Object.freeze({ label: "光度", unit: "万 L☉" }),
  stability: Object.freeze({ label: "动态稳定度", unit: "%" }),
  fuel: Object.freeze({ label: "可用燃料", unit: "%" }),
  elementDiversity: Object.freeze({ label: "复杂物质", unit: "级" }),
  expelledMatter: Object.freeze({ label: "抛射物质", unit: "M☉" }),
  diskMass: Object.freeze({ label: "行星盘质量", unit: "M☉" }),
  diskStability: Object.freeze({ label: "行星盘结构度", unit: "%" }),
})

export function formatStellarMetric(metricId, value) {
  const definition = STELLAR_DISPLAY_METRICS[metricId]
  if (!definition) throw new TypeError(`Unknown stellar display metric: ${metricId}`)
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${metricId} must be a non-negative safe integer`)
  return {
    ...definition,
    value,
    text: `${value} ${definition.unit}`,
  }
}
