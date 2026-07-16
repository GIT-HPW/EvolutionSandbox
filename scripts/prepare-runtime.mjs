// SPDX-License-Identifier: GPL-3.0-or-later

import { createHash } from "node:crypto"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

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

export async function prepareRuntime() {
  const runtimeDir = resolve(process.env.EVOLUTION_RUNTIME_DIR || join(root, "runtime"))
  const defaultWorldDir = join(runtimeDir, "world")
  const worldDir = resolve(process.env.EVOLUTION_WORLD_DIR || defaultWorldDir)
  const externalWorld = worldDir.toLowerCase() !== resolve(defaultWorldDir).toLowerCase()
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
  await writeFile(worldPath, worldText, "utf8")

  const destination = join(worldModsDir, "evolution_core")
  const marker = join(destination, ".evolutionsandbox-managed")
  if (externalWorld && backupDir && await exists(join(destination, "mod.conf")) && !(await exists(marker))) {
    const backupMod = join(backupDir, "evolution_core")
    if (!(await exists(join(backupMod, "mod.conf")))) await cp(destination, backupMod, { recursive: true })
  }
  await rm(destination, { recursive: true, force: true })
  await cp(join(root, "mods", "evolution_core"), destination, { recursive: true, force: true })
  await writeFile(join(destination, ".evolutionsandbox-managed"), "Managed by EvolutionSandbox prepare-runtime.mjs\n", "utf8")

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
  await writeFile(configPath, config, "utf8")

  const luantiBinary = process.env.LUANTI_SERVER_BIN || (process.platform === "win32" ? "luantiserver.exe" : "luantiserver")
  const luantiPort = process.env.LUANTI_PORT || "30000"
  return { root, runtimeDir, worldDir, configPath, gameId, luantiBinary, luantiPort, externalWorld, backupDir, mode }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await prepareRuntime()
  console.log("Runtime prepared: " + result.runtimeDir)
  console.log("World: " + result.worldDir + (result.externalWorld ? " (external world)" : ""))
  console.log("Mode: " + result.mode)
  if (result.backupDir) console.log("Pre-integration config/mod backup: " + result.backupDir)
}
