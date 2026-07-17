// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

async function exists(path) {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

function upsertSetting(text, key, value) {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => {
    const trimmed = line.trimStart()
    return trimmed.startsWith(key + " =") || trimmed.startsWith(key + "=")
  })
  const next = `${key} = ${value}`
  if (index >= 0) lines[index] = next
  else lines.push(next)
  return lines.join("\n").trimEnd() + "\n"
}

function appendListSetting(text, key, value) {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex((line) => {
    const trimmed = line.trimStart()
    return trimmed.startsWith(key + " =") || trimmed.startsWith(key + "=")
  })
  const existing = index >= 0 ? lines[index].split("=").slice(1).join("=") : ""
  const values = existing.split(",").map((item) => item.trim()).filter(Boolean)
  if (!values.includes(value)) values.push(value)
  const next = `${key} = ${values.join(",")}`
  if (index >= 0) lines[index] = next
  else lines.push(next)
  return lines.join("\n").trimEnd() + "\n"
}

function requireEsipUri(name, value) {
  if (typeof value !== "string" || /[\r\n]/.test(value) || value.length > 255) {
    throw new Error(`${name} must be a single-line ESIP URI`)
  }
  let url
  try { url = new URL(value) } catch { throw new Error(`${name} must be a valid ESIP URI`) }
  if (url.protocol !== "esip:" || url.username || url.password) throw new Error(`${name} must be an ESIP URI without credentials`)
  return value
}

function requireLoopbackUrl(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error("ESIP_SIDECAR_URL must be a single-line URL")
  let url
  try { url = new URL(value) } catch { throw new Error("ESIP_SIDECAR_URL must be a valid URL") }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1"
  if (url.protocol !== "http:" || !loopback || !url.port || url.username || url.password
      || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("ESIP_SIDECAR_URL must be a loopback HTTP origin with an explicit port")
  }
  return value.replace(/\/$/, "")
}

export async function prepareRuntime() {
  const runtimeDir = resolve(process.env.EVOLUTION_RUNTIME_DIR || join(root, "runtime"))
  const defaultWorldDir = join(runtimeDir, "world")
  const worldDir = resolve(process.env.EVOLUTION_WORLD_DIR || defaultWorldDir)
  const externalWorld = worldDir.toLowerCase() !== resolve(defaultWorldDir).toLowerCase()
  const bridgeToken = process.env.EVOLUTION_ESIP_TOKEN || ""
  if (bridgeToken && !TOKEN_PATTERN.test(bridgeToken)) {
    throw new Error("EVOLUTION_ESIP_TOKEN must contain 32-256 URL-safe ASCII characters")
  }
  const bridgeEnabled = TOKEN_PATTERN.test(bridgeToken)
  let bridgeConfig
  if (bridgeEnabled) {
    const adapterId = process.env.ESIP_LUANTI_ADAPTER_ID || "luanti-world-alpha"
    const universeId = process.env.ESIP_UNIVERSE_ID || "universe-1"
    if (!ID_PATTERN.test(adapterId)) throw new Error("ESIP_LUANTI_ADAPTER_ID is invalid")
    if (!ID_PATTERN.test(universeId)) throw new Error("ESIP_UNIVERSE_ID is invalid")
    const allowedSourceText = process.env.ESIP_ALLOWED_COMMAND_SOURCES || "esip://local/control"
    const allowedSources = allowedSourceText.split(",").map((value) => value.trim()).filter(Boolean)
    if (allowedSources.length === 0) throw new Error("ESIP_ALLOWED_COMMAND_SOURCES must not be empty")
    for (const value of allowedSources) requireEsipUri("ESIP_ALLOWED_COMMAND_SOURCES", value)
    bridgeConfig = {
      url: requireLoopbackUrl(process.env.ESIP_SIDECAR_URL || "http://127.0.0.1:7070"),
      source: requireEsipUri("ESIP_LUANTI_SOURCE", process.env.ESIP_LUANTI_SOURCE || "esip://luanti/world-alpha"),
      adapterId,
      universeId,
      allowedSources: allowedSources.join(","),
    }
  }
  const worldModsDir = join(worldDir, "worldmods")
  const worldPath = join(worldDir, "world.mt")
  await mkdir(worldModsDir, { recursive: true })

  let worldText
  let worldExisted = true
  try {
    worldText = await readFile(worldPath, "utf8")
  } catch {
    worldExisted = false
    worldText = await readFile(join(root, "templates", "world.mt"), "utf8")
  }

  const requestedGameId = process.env.LUANTI_GAME_ID || ""
  const worldGameId = worldExisted ? worldText.match(/^gameid\s*=\s*(\S+)\s*$/m)?.[1] : undefined
  if (requestedGameId && worldGameId && requestedGameId !== worldGameId) {
    throw new Error(`LUANTI_GAME_ID=${requestedGameId} conflicts with existing world gameid=${worldGameId}`)
  }
  const gameId = requestedGameId || worldGameId || "mineclonia"

  let backupDir
  if (externalWorld && worldExisted) {
    const worldKey = createHash("sha256").update(worldDir).digest("hex").slice(0, 12)
    backupDir = join(runtimeDir, "backups", worldKey)
    await mkdir(backupDir, { recursive: true })
    const backupWorld = join(backupDir, "world.mt")
    if (!(await exists(backupWorld))) await writeFile(backupWorld, worldText, "utf8")
  }

  worldText = worldText.replace("__GAME_ID__", gameId)
  worldText = upsertSetting(worldText, "load_mod_evolution_core", "true")
  if (bridgeEnabled) worldText = upsertSetting(worldText, "load_mod_evolution_bridge", "true")
  await writeFile(worldPath, worldText, "utf8")

  async function installManagedMod(name) {
    const destination = join(worldModsDir, name)
    const marker = join(destination, ".evolutionsandbox-managed")
    if (externalWorld && backupDir && await exists(join(destination, "mod.conf")) && !(await exists(marker))) {
      const backupMod = join(backupDir, name)
      if (!(await exists(join(backupMod, "mod.conf")))) await cp(destination, backupMod, { recursive: true })
    }
    await rm(destination, { recursive: true, force: true })
    await cp(join(root, "mods", name), destination, { recursive: true, force: true })
    await writeFile(join(destination, ".evolutionsandbox-managed"), "Managed by EvolutionSandbox prepare-runtime.mjs\n", "utf8")
  }
  await installManagedMod("evolution_core")
  if (bridgeEnabled) await installManagedMod("evolution_bridge")

  const mode = process.env.EVOLUTION_MODE || (externalWorld ? "integrated" : "standalone")
  if (mode !== "standalone" && mode !== "integrated") throw new Error("EVOLUTION_MODE must be standalone or integrated")
  const configPath = join(runtimeDir, "minetest.conf")
  let config
  try {
    config = await readFile(configPath, "utf8")
  } catch {
    config = await readFile(join(root, "templates", "minetest.conf.example"), "utf8")
  }
  config = config.replaceAll("__EVOLUTION_MODE__", mode)
  config = upsertSetting(config, "evolution_mode", mode)
  if (bridgeEnabled) {
    config = appendListSetting(config, "secure.http_mods", "evolution_bridge")
    config = upsertSetting(config, "evolution_bridge_enabled", "true")
    config = upsertSetting(config, "evolution_bridge_token", bridgeToken)
    config = upsertSetting(config, "evolution_bridge_url", bridgeConfig.url)
    config = upsertSetting(config, "evolution_bridge_source", bridgeConfig.source)
    config = upsertSetting(config, "evolution_bridge_adapter_id", bridgeConfig.adapterId)
    config = upsertSetting(config, "evolution_bridge_universe_id", bridgeConfig.universeId)
    config = upsertSetting(config, "evolution_bridge_allowed_sources", bridgeConfig.allowedSources)
  }
  await writeFile(configPath, config, "utf8")

  const luantiBinary = process.env.LUANTI_SERVER_BIN || (process.platform === "win32" ? "luantiserver.exe" : "luantiserver")
  const luantiPort = process.env.LUANTI_PORT || "30000"
  return { root, runtimeDir, worldDir, configPath, gameId, luantiBinary, luantiPort, externalWorld, backupDir, mode, bridgeEnabled }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareRuntime()
  console.log("Runtime prepared: " + result.runtimeDir)
  console.log("World: " + result.worldDir + (result.externalWorld ? " (external world)" : ""))
  console.log("Mode: " + result.mode)
  console.log("ESIP bridge: " + (result.bridgeEnabled ? "enabled" : "disabled (set EVOLUTION_ESIP_TOKEN to opt in)"))
  if (result.backupDir) console.log("Pre-integration config/mod backup: " + result.backupDir)
}
