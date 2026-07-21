// SPDX-License-Identifier: GPL-3.0-or-later

export { EsipAdapter } from "./adapter.mjs"
export { DEFAULT_BROWSER_STORAGE_KEY, createBrowserEvolutionAdapter } from "./browser-game-adapter.mjs"
export { createMessage } from "./envelope.mjs"
export { EsipError } from "./errors.mjs"
export { createEvolutionRulesAdapter } from "./evolution-rules-adapter.mjs"
export { HttpSidecar, createHttpSidecar } from "./http-sidecar.mjs"
export { CLOUD_EVENTS_VERSION, ESIP_VERSION, KINDS, MESSAGE_DEFINITIONS, SCHEMA_BASE_URL, TYPES, schemaUrlFor, typeMatches } from "./message-types.mjs"
export { MemoryRouter } from "./router.mjs"
export {
  JournalSidecarStore,
  MemorySidecarStore,
  SIDECAR_CHECKPOINT_SCHEMA,
  SIDECAR_JOURNAL_SCHEMA,
  SIDECAR_STATE_SCHEMA,
  SidecarStore,
  createJournalSidecarStore,
  createMemorySidecarStore,
} from "./sidecar-store.mjs"
export { validateEnvelope, validateMessage } from "./validation.mjs"
