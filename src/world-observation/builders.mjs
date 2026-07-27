// SPDX-License-Identifier: GPL-3.0-or-later

import { validateWorldObservation, WORLD_OBSERVATION_SCHEMA_VERSION } from "./validation.mjs"

export function metric(id, label, value, unit = "") {
  return { id, label, value, unit }
}

export function recentEvent(domain, raw, index, fallbackTick, fallbackSummary) {
  const tick = Number.isSafeInteger(raw.tick) ? raw.tick : fallbackTick
  const type = raw.type ?? raw.action ?? `${domain}_event`
  const cursor = Number.isSafeInteger(raw.cursor) ? raw.cursor : index
  return {
    id: `${domain}:${tick}:${cursor}:${type}`,
    type,
    tick,
    summary: raw.title ?? raw.summary ?? raw.result ?? fallbackSummary,
  }
}

export function buildObservation(input) {
  return validateWorldObservation({ schemaVersion: WORLD_OBSERVATION_SCHEMA_VERSION, ...input })
}
