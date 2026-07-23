// SPDX-License-Identifier: GPL-3.0-or-later

export const SCENE_FLOW_STORAGE_KEY = "evolution-sandbox.scene-flow.v1"

const SCHEMA_VERSION = 1
const STATES = new Set([
  "boot",
  "stage_select",
  "loading",
  "playing",
  "paused",
  "checkpointing",
  "transitioning",
  "error",
])
const TRANSITIONS = {
  boot: new Set(["stage_select", "loading"]),
  stage_select: new Set(["loading"]),
  loading: new Set(["playing", "error"]),
  playing: new Set(["paused", "error"]),
  paused: new Set(["playing", "checkpointing", "transitioning", "error"]),
  checkpointing: new Set(["paused", "error"]),
  transitioning: new Set(["stage_select", "loading", "error"]),
  error: new Set(["stage_select"]),
}
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class SceneFlowError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "SceneFlowError"
    this.code = code
  }
}

function assertStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("storage must implement getItem and setItem")
  }
}

function assertSceneId(sceneId) {
  if (typeof sceneId !== "string" || !ID_PATTERN.test(sceneId)) {
    throw new SceneFlowError("invalid_scene", "sceneId is invalid")
  }
}

function initialSnapshot(now) {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: "boot",
    sceneId: null,
    lastSceneId: null,
    revision: 0,
    checkpoint: null,
    updatedAt: now(),
  }
}

function validateCheckpoint(checkpoint) {
  if (checkpoint === null) return null
  if (typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    throw new SceneFlowError("invalid_navigation_record", "checkpoint must be an object")
  }
  if (typeof checkpoint.sceneId !== "string" || !ID_PATTERN.test(checkpoint.sceneId)) {
    throw new SceneFlowError("invalid_navigation_record", "checkpoint.sceneId is invalid")
  }
  if (!Number.isSafeInteger(checkpoint.flowRevision) || checkpoint.flowRevision < 0) {
    throw new SceneFlowError("invalid_navigation_record", "checkpoint.flowRevision is invalid")
  }
  if (typeof checkpoint.savedAt !== "string") {
    throw new SceneFlowError("invalid_navigation_record", "checkpoint.savedAt is invalid")
  }
  if (typeof checkpoint.metadata !== "object" || checkpoint.metadata === null || Array.isArray(checkpoint.metadata)) {
    throw new SceneFlowError("invalid_navigation_record", "checkpoint.metadata must be an object")
  }
  return structuredClone(checkpoint)
}

function validateSnapshot(record) {
  if (typeof record !== "object" || record === null || Array.isArray(record) || record.schemaVersion !== SCHEMA_VERSION) {
    throw new SceneFlowError("invalid_navigation_record", "scene navigation record schema is invalid")
  }
  if (!STATES.has(record.state)) throw new SceneFlowError("invalid_navigation_record", "scene navigation state is invalid")
  if (record.sceneId !== null) assertSceneId(record.sceneId)
  if (record.lastSceneId !== null) assertSceneId(record.lastSceneId)
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
    throw new SceneFlowError("invalid_navigation_record", "scene navigation revision is invalid")
  }
  if (typeof record.updatedAt !== "string") throw new SceneFlowError("invalid_navigation_record", "scene navigation timestamp is invalid")
  if (["loading", "playing", "paused", "checkpointing"].includes(record.state) && record.sceneId === null) {
    throw new SceneFlowError("invalid_navigation_record", `${record.state} requires an active scene`)
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    state: record.state,
    sceneId: record.sceneId,
    lastSceneId: record.lastSceneId,
    revision: record.revision,
    checkpoint: validateCheckpoint(record.checkpoint),
    updatedAt: record.updatedAt,
  }
}

function loadSnapshot(storage, storageKey, now) {
  const raw = storage.getItem(storageKey)
  if (raw === null) return initialSnapshot(now)
  let parsed
  try { parsed = JSON.parse(raw) } catch {
    throw new SceneFlowError("invalid_navigation_record", "scene navigation record is not valid JSON")
  }
  return validateSnapshot(parsed)
}

export class SceneFlowController {
  constructor({ storage = globalThis.localStorage, storageKey = SCENE_FLOW_STORAGE_KEY, now = () => new Date().toISOString() } = {}) {
    assertStorage(storage)
    if (typeof storageKey !== "string" || storageKey.length === 0) throw new TypeError("storageKey is required")
    if (typeof now !== "function") throw new TypeError("now must be a function")
    this._storage = storage
    this._storageKey = storageKey
    this._now = now
    this._record = loadSnapshot(storage, storageKey, now)
  }

  snapshot() {
    return structuredClone(this._record)
  }

  _persist() {
    this._record.updatedAt = this._now()
    this._storage.setItem(this._storageKey, JSON.stringify(validateSnapshot(this._record)))
  }

  _transition(nextState, { sceneId = this._record.sceneId } = {}) {
    if (!TRANSITIONS[this._record.state].has(nextState)) {
      throw new SceneFlowError("invalid_transition", `${this._record.state} cannot transition to ${nextState}`)
    }
    if (sceneId !== null) assertSceneId(sceneId)
    this._record.state = nextState
    this._record.sceneId = sceneId
    this._record.revision += 1
    this._persist()
    return this.snapshot()
  }

  showStageSelect() {
    if (this._record.state === "stage_select") return this.snapshot()
    if (["boot", "transitioning", "error"].includes(this._record.state)) {
      return this._transition("stage_select", { sceneId: null })
    }
    // Loading the lobby itself is a hard page boundary. Recovering here records
    // the abandoned scene instead of allowing its timers to remain authoritative.
    this._record.lastSceneId = this._record.sceneId ?? this._record.lastSceneId
    this._record.state = "stage_select"
    this._record.sceneId = null
    this._record.revision += 1
    this._persist()
    return this.snapshot()
  }

  selectScene(sceneId, allowedSceneIds) {
    assertSceneId(sceneId)
    if (!Array.isArray(allowedSceneIds) || !allowedSceneIds.includes(sceneId)) {
      throw new SceneFlowError("scene_unavailable", `scene ${sceneId} is not available in this build`)
    }
    if (this._record.state !== "stage_select") throw new SceneFlowError("invalid_transition", "a scene can only be selected from the stage lobby")
    return this._transition("loading", { sceneId })
  }

  sceneReady(sceneId) {
    assertSceneId(sceneId)
    if (this._record.state === "playing" && this._record.sceneId === sceneId) return this.snapshot()
    if (this._record.state === "paused" && this._record.sceneId === sceneId) return this._transition("playing", { sceneId })
    if (this._record.state !== "loading" || this._record.sceneId !== sceneId) {
      throw new SceneFlowError("scene_mismatch", `navigation did not authorize scene ${sceneId}`)
    }
    this._record.lastSceneId = sceneId
    return this._transition("playing", { sceneId })
  }

  pause() {
    if (this._record.state === "paused") return this.snapshot()
    return this._transition("paused")
  }

  resume() {
    if (this._record.state === "playing") return this.snapshot()
    return this._transition("playing")
  }

  beginCheckpoint() {
    return this._transition("checkpointing")
  }

  completeCheckpoint(metadata = {}) {
    if (this._record.state !== "checkpointing") {
      throw new SceneFlowError("invalid_transition", "no checkpoint is being written")
    }
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      throw new SceneFlowError("invalid_checkpoint", "checkpoint metadata must be an object")
    }
    try { JSON.stringify(metadata) } catch { throw new SceneFlowError("invalid_checkpoint", "checkpoint metadata must be serializable") }
    this._record.checkpoint = {
      sceneId: this._record.sceneId,
      flowRevision: this._record.revision,
      savedAt: this._now(),
      metadata: structuredClone(metadata),
    }
    return this._transition("paused")
  }

  failCheckpoint() {
    if (this._record.state !== "checkpointing") return this.snapshot()
    return this._transition("paused")
  }

  beginMenuTransition() {
    this._record.lastSceneId = this._record.sceneId
    return this._transition("transitioning", { sceneId: null })
  }
}

export function clearSceneFlow(storage = globalThis.localStorage, storageKey = SCENE_FLOW_STORAGE_KEY) {
  if (!storage || typeof storage.removeItem !== "function") throw new TypeError("storage must implement removeItem")
  storage.removeItem(storageKey)
}

function requiredElement(root, selector) {
  const element = root.querySelector(selector)
  if (!element) throw new Error(`Missing scene options element: ${selector}`)
  return element
}

export function bindSceneOptions({
  sceneId,
  root = document,
  storage = globalThis.localStorage,
  navigate = (href) => globalThis.location.assign(href),
  checkpoint,
  onPause = () => {},
  onResume = () => {},
} = {}) {
  assertSceneId(sceneId)
  if (typeof checkpoint !== "function") throw new TypeError("checkpoint must be a function")
  const trigger = requiredElement(root, "#game-options")
  const overlay = requiredElement(root, "#game-options-menu")
  const resumeButton = requiredElement(root, "#options-resume")
  const saveButton = requiredElement(root, "#options-save")
  const exitButton = requiredElement(root, "#options-exit")
  const status = requiredElement(root, "#options-status")
  let flow
  let ready = false
  let open = false
  let saving = false

  try {
    flow = new SceneFlowController({ storage })
  } catch (error) {
    trigger.disabled = true
    trigger.title = `场景导航记录不可用：${error.message}`
    return {
      markReady() { return true },
      setAvailable() {},
      error,
    }
  }

  function setBusy(value) {
    saving = value
    resumeButton.disabled = value
    saveButton.disabled = value
    exitButton.disabled = value
  }

  async function openMenu() {
    if (!ready || open || saving) return
    flow.pause()
    try {
      await onPause()
    } catch (error) {
      flow.resume()
      throw error
    }
    open = true
    overlay.hidden = false
    status.textContent = "场景已暂停。切换前会先写入本地检查点。"
    resumeButton.focus()
  }

  async function resumeScene() {
    if (!open || saving) return
    await onResume()
    flow.resume()
    open = false
    overlay.hidden = true
    trigger.focus()
  }

  async function writeCheckpoint() {
    setBusy(true)
    status.textContent = "正在写入并校验场景检查点……"
    flow.beginCheckpoint()
    try {
      const metadata = await checkpoint()
      flow.completeCheckpoint(metadata)
      status.textContent = "检查点已保存，可以安全继续或退出。"
      return true
    } catch (error) {
      flow.failCheckpoint()
      status.textContent = `保存失败：${error.message}`
      return false
    } finally {
      setBusy(false)
    }
  }

  trigger.addEventListener("click", () => { void openMenu() })
  resumeButton.addEventListener("click", () => { void resumeScene() })
  saveButton.addEventListener("click", () => { void writeCheckpoint() })
  exitButton.addEventListener("click", async () => {
    if (!open || saving || !await writeCheckpoint()) return
    setBusy(true)
    status.textContent = "检查点已确认，正在返回阶段选择……"
    flow.beginMenuTransition()
    navigate("index.html")
  })
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open && !saving) void resumeScene()
  })

  return {
    markReady() {
      try {
        flow.sceneReady(sceneId)
        ready = true
        trigger.disabled = false
        return true
      } catch (error) {
        if (error instanceof SceneFlowError && error.code === "scene_mismatch") {
          navigate("index.html")
          return false
        }
        throw error
      }
    },
    setAvailable(available) {
      trigger.disabled = !ready || !available
    },
    snapshot: () => flow.snapshot(),
  }
}
