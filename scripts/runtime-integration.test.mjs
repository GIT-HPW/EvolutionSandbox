// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { prepareRuntime } from "./prepare-runtime.mjs"

test("existing world integration is opt-in and preserves player data", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "evolutionsandbox-"))
  const runtimeDir = join(testRoot, "runtime")
  const worldDir = join(testRoot, "existing-world")
  const oldModDir = join(worldDir, "worldmods", "evolution_core")
  const playerData = Buffer.from("simulated-player-database")
  const authData = Buffer.from("simulated-auth-database")
  const oldWorld = "gameid = mineclonia\nbackend = sqlite3\nload_mod_evolution_core = false\n"

  await mkdir(oldModDir, { recursive: true })
  await writeFile(join(worldDir, "world.mt"), oldWorld, "utf8")
  await writeFile(join(worldDir, "players.sqlite"), playerData)
  await writeFile(join(worldDir, "auth.sqlite"), authData)
  await writeFile(join(oldModDir, "mod.conf"), "name = evolution_core\nlegacy = true\n", "utf8")

  const previous = {
    runtime: process.env.EVOLUTION_RUNTIME_DIR,
    world: process.env.EVOLUTION_WORLD_DIR,
    mode: process.env.EVOLUTION_MODE,
    token: process.env.EVOLUTION_ESIP_TOKEN,
  }
  process.env.EVOLUTION_RUNTIME_DIR = runtimeDir
  process.env.EVOLUTION_WORLD_DIR = worldDir
  delete process.env.EVOLUTION_MODE
  delete process.env.EVOLUTION_ESIP_TOKEN

  try {
    const result = await prepareRuntime()
    assert.equal(result.externalWorld, true)
    assert.equal(result.mode, "integrated")
    assert.ok(result.backupDir)
    assert.match(await readFile(join(worldDir, "world.mt"), "utf8"), /^load_mod_evolution_core = true$/m)
    assert.match(await readFile(join(runtimeDir, "minetest.conf"), "utf8"), /^evolution_mode = integrated$/m)
    assert.deepEqual(await readFile(join(worldDir, "players.sqlite")), playerData)
    assert.deepEqual(await readFile(join(worldDir, "auth.sqlite")), authData)
    assert.equal(await readFile(join(worldDir, "worldmods", "evolution_core", ".evolutionsandbox-managed"), "utf8"),
      "Managed by EvolutionSandbox prepare-runtime.mjs\n")
    assert.match(await readFile(join(worldDir, "worldmods", "evolution_core", "identity.lua"), "utf8"), /identity_registry_v1/)
    assert.match(await readFile(join(worldDir, "worldmods", "evolution_core", "timelines.lua"), "utf8"), /timeline_registry_v1/)
    assert.equal(await readFile(join(result.backupDir, "world.mt"), "utf8"), oldWorld)
    assert.match(await readFile(join(result.backupDir, "evolution_core", "mod.conf"), "utf8"), /legacy = true/)
  } finally {
    for (const [key, value] of Object.entries({
      EVOLUTION_RUNTIME_DIR: previous.runtime,
      EVOLUTION_WORLD_DIR: previous.world,
      EVOLUTION_MODE: previous.mode,
      EVOLUTION_ESIP_TOKEN: previous.token,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(testRoot, { recursive: true, force: true })
  }
})

test("ESIP bridge installation is opt-in and keeps its token outside the source tree", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "evolutionsandbox-bridge-"))
  const runtimeDir = join(testRoot, "runtime")
  const optionalNames = [
    "ESIP_SIDECAR_URL", "ESIP_LUANTI_SOURCE", "ESIP_LUANTI_ADAPTER_ID",
    "ESIP_UNIVERSE_ID", "ESIP_ALLOWED_COMMAND_SOURCES",
  ]
  const previous = {
    runtime: process.env.EVOLUTION_RUNTIME_DIR,
    world: process.env.EVOLUTION_WORLD_DIR,
    token: process.env.EVOLUTION_ESIP_TOKEN,
    optional: Object.fromEntries(optionalNames.map((name) => [name, process.env[name]])),
  }
  process.env.EVOLUTION_RUNTIME_DIR = runtimeDir
  delete process.env.EVOLUTION_WORLD_DIR
  for (const name of optionalNames) delete process.env[name]
  process.env.EVOLUTION_ESIP_TOKEN = "x".repeat(32) + "\nsecure.http_mods = attacker"
  await assert.rejects(prepareRuntime(), /URL-safe ASCII/)
  process.env.EVOLUTION_ESIP_TOKEN = "runtime-test-token-" + "x".repeat(40)

  try {
    const result = await prepareRuntime()
    assert.equal(result.bridgeEnabled, true)
    assert.match(await readFile(join(result.worldDir, "world.mt"), "utf8"), /^load_mod_evolution_bridge = true$/m)
    assert.match(await readFile(result.configPath, "utf8"), /^secure\.http_mods = evolution_bridge$/m)
    assert.match(await readFile(result.configPath, "utf8"), /^evolution_bridge_token = runtime-test-token-x+$/m)
    assert.equal(await readFile(join(result.worldDir, "worldmods", "evolution_bridge", ".evolutionsandbox-managed"), "utf8"),
      "Managed by EvolutionSandbox prepare-runtime.mjs\n")
  } finally {
    for (const [key, value] of Object.entries({
      EVOLUTION_RUNTIME_DIR: previous.runtime,
      EVOLUTION_WORLD_DIR: previous.world,
      EVOLUTION_ESIP_TOKEN: previous.token,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const [key, value] of Object.entries(previous.optional)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(testRoot, { recursive: true, force: true })
  }
})
