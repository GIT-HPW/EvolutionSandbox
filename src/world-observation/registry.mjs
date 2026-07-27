// SPDX-License-Identifier: GPL-3.0-or-later

import { validateWorldObservation, WorldObservationError } from "./validation.mjs"

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function requireId(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new WorldObservationError("invalid_registry", `${path} must be a valid identifier`)
  }
}

export class WorldObservationRegistry {
  constructor() {
    this._providers = new Map()
  }

  register(id, { domain, universeId, source, observe }) {
    requireId(id, "registry id")
    requireId(universeId, "registry universeId")
    requireId(source, "registry source")
    if (typeof observe !== "function") throw new WorldObservationError("invalid_registry", "registry observe must be a function")
    if (this._providers.has(id)) throw new WorldObservationError("registry_conflict", `observer ${id} is already registered`)
    this._providers.set(id, { domain, universeId, source, observe })
    return this
  }

  get(id) {
    const provider = this._providers.get(id)
    if (!provider) throw new WorldObservationError("observer_not_found", `observer ${id} is not registered`)
    const observation = provider.observe()
    return validateWorldObservation(observation, {
      allowedSources: [provider.source],
      expectedDomain: provider.domain,
      expectedUniverseId: provider.universeId,
    })
  }

  list() {
    return [...this._providers.keys()].sort().map((id) => ({ id, observation: this.get(id) }))
  }

  compare(leftId, rightId) {
    const left = this.get(leftId)
    const right = this.get(rightId)
    const leftMetrics = new Map(left.summary.metrics.map((entry) => [entry.id, entry.value]))
    const rightMetrics = new Map(right.summary.metrics.map((entry) => [entry.id, entry.value]))
    const metricIds = [...new Set([...leftMetrics.keys(), ...rightMetrics.keys()])].sort()
    return {
      leftId,
      rightId,
      sameUniverse: left.universeId === right.universeId,
      sameTimeline: left.timelineId === right.timelineId,
      tickDelta: right.tick - left.tick,
      revisionDelta: right.revision - left.revision,
      phaseChanged: left.phase !== right.phase,
      metricChanges: metricIds.map((id) => ({
        id,
        left: leftMetrics.has(id) ? leftMetrics.get(id) : null,
        right: rightMetrics.has(id) ? rightMetrics.get(id) : null,
      })),
    }
  }
}
