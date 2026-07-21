// SPDX-License-Identifier: GPL-3.0-or-later

import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHttpSidecar, createJournalSidecarStore, createMemorySidecarStore } from "../src/interop/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

function integerSetting(name, fallback, { min, max }) {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

const token = process.env.EVOLUTION_ESIP_TOKEN
if (!token || !/^[A-Za-z0-9._~-]{32,256}$/.test(token)) {
  throw new Error("EVOLUTION_ESIP_TOKEN must contain 32-256 URL-safe ASCII characters; see docs/interop.md")
}

const host = process.env.ESIP_SIDECAR_HOST || "127.0.0.1"
const port = integerSetting("ESIP_SIDECAR_PORT", 7070, { min: 1, max: 65535 })
const luantiSource = process.env.ESIP_LUANTI_SOURCE || "esip://luanti/world-alpha"
const luantiAdapterId = process.env.ESIP_LUANTI_ADAPTER_ID || "luanti-world-alpha"
const allowedCommandSources = (process.env.ESIP_ALLOWED_COMMAND_SOURCES || "esip://local/control")
  .split(",").map((value) => value.trim()).filter(Boolean)
const storeMode = process.env.ESIP_SIDECAR_STORE || "journal"
if (storeMode !== "journal" && storeMode !== "memory") {
  throw new Error("ESIP_SIDECAR_STORE must be journal or memory")
}
const runtimeDir = resolve(process.env.EVOLUTION_RUNTIME_DIR || join(root, "runtime"))
const storeDirectory = resolve(process.env.ESIP_SIDECAR_STORE_DIR || join(runtimeDir, "sidecar"))
const checkpointEvery = integerSetting("ESIP_SIDECAR_CHECKPOINT_EVERY", 100, { min: 1, max: 1_000_000 })
const maxMessageBytes = integerSetting("ESIP_SIDECAR_MAX_MESSAGE_BYTES", 64 * 1024, { min: 1024, max: 4 * 1024 * 1024 })
const maxPendingCommands = integerSetting("ESIP_SIDECAR_MAX_PENDING_COMMANDS", 1000, { min: 1, max: 1_000_000 })
const maxResults = integerSetting("ESIP_SIDECAR_MAX_RESULTS", 1000, { min: 1, max: 1_000_000 })
const seenLimit = integerSetting("ESIP_SIDECAR_SEEN_LIMIT", 10_000, { min: 100, max: 1_000_000 })
const leaseMs = integerSetting("ESIP_SIDECAR_LEASE_MS", 5000, { min: 100, max: 300_000 })
const maxCommandTtlMs = integerSetting("ESIP_SIDECAR_MAX_COMMAND_TTL_MS", 60_000, { min: 1000, max: 3_600_000 })
const store = storeMode === "journal"
  ? createJournalSidecarStore({ directory: storeDirectory, checkpointEvery })
  : createMemorySidecarStore()

const sidecar = createHttpSidecar({
  token,
  host,
  port,
  luantiSource,
  luantiAdapterId,
  allowedCommandSources,
  maxMessageBytes,
  maxPendingCommands,
  maxResults,
  seenLimit,
  leaseMs,
  maxCommandTtlMs,
  store,
})
const address = await sidecar.listen()
const displayHost = address.host.includes(":") ? `[${address.host}]` : address.host

console.log(`Evolution ESIP sidecar listening on http://${displayHost}:${address.port}`)
console.log(`Luanti target: ${luantiSource}`)
console.log(`Allowed command sources: ${allowedCommandSources.join(", ")}`)
console.log(`Sidecar store: ${storeMode}${storeMode === "journal" ? ` (${storeDirectory})` : ""}`)
console.log("The bearer token is loaded from EVOLUTION_ESIP_TOKEN and is not printed.")

let stopping = false
async function stop(signal) {
  if (stopping) return
  stopping = true
  console.log(`Stopping sidecar after ${signal}...`)
  await sidecar.close()
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stop(signal).catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
  })
}
