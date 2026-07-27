// SPDX-License-Identifier: GPL-3.0-or-later

export const AUTO_EVOLUTION_STORAGE_KEY = "evolution-sandbox.auto-evolution.v1"

const SCHEMA_VERSION = 1
const ACTIVE = new Set(["origin_running", "transitioning", "stellar_running"])
const STATUSES = new Set([...ACTIVE, "paused", "completed", "cancelled", "failed"])
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/
const SCENE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("storage must implement getItem and setItem")
  }
}

function validate(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record) || record.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("auto evolution record schema is invalid")
  }
  if (typeof record.runId !== "string" || !ID_PATTERN.test(record.runId)) throw new Error("auto evolution runId is invalid")
  for (const key of ["fromScene", "targetScene"]) {
    if (typeof record[key] !== "string" || !SCENE_PATTERN.test(record[key])) throw new Error(`auto evolution ${key} is invalid`)
  }
  if (record.fromScene === record.targetScene) throw new Error("auto evolution target scene must differ from its source")
  if (!STATUSES.has(record.status)) throw new Error("auto evolution status is invalid")
  if (typeof record.startedAt !== "string" || typeof record.updatedAt !== "string") {
    throw new Error("auto evolution timestamps are invalid")
  }
  if (record.error !== null && (typeof record.error !== "string" || record.error.length > 512)) {
    throw new Error("auto evolution error is invalid")
  }
  return structuredClone(record)
}

function persist(storage, record) {
  const safe = validate(record)
  storage.setItem(AUTO_EVOLUTION_STORAGE_KEY, JSON.stringify(safe))
  return safe
}

export function loadAutoEvolution(storage = globalThis.localStorage) {
  assertStorage(storage)
  const raw = storage.getItem(AUTO_EVOLUTION_STORAGE_KEY)
  if (raw === null) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error("auto evolution record is not valid JSON") }
  return validate(parsed)
}

export function startAutoEvolution({
  storage = globalThis.localStorage,
  runId,
  fromScene = "origin",
  targetScene = "stellar",
  replace = false,
  now = () => new Date().toISOString(),
} = {}) {
  assertStorage(storage)
  if (typeof now !== "function") throw new TypeError("now must be a function")
  const previous = loadAutoEvolution(storage)
  if (previous && ACTIVE.has(previous.status) && !replace) throw new Error("another auto evolution run is already active")
  const timestamp = now()
  return persist(storage, {
    schemaVersion: SCHEMA_VERSION,
    runId,
    fromScene,
    targetScene,
    status: "origin_running",
    startedAt: timestamp,
    updatedAt: timestamp,
    error: null,
  })
}

export function updateAutoEvolution(status, {
  storage = globalThis.localStorage,
  runId,
  error = null,
  now = () => new Date().toISOString(),
} = {}) {
  assertStorage(storage)
  if (!STATUSES.has(status)) throw new TypeError("auto evolution status is invalid")
  if (typeof now !== "function") throw new TypeError("now must be a function")
  const current = loadAutoEvolution(storage)
  if (!current || current.runId !== runId) throw new Error("auto evolution run is missing or changed")
  return persist(storage, { ...current, status, error, updatedAt: now() })
}

export function isActiveAutoEvolution(record) {
  return record !== null && ACTIVE.has(record.status)
}
