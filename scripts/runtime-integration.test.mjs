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
  }
  process.env.EVOLUTION_RUNTIME_DIR = runtimeDir
  process.env.EVOLUTION_WORLD_DIR = worldDir
  delete process.env.EVOLUTION_MODE

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
    assert.equal(await readFile(join(result.backupDir, "world.mt"), "utf8"), oldWorld)
    assert.match(await readFile(join(result.backupDir, "evolution_core", "mod.conf"), "utf8"), /legacy = true/)
  } finally {
    for (const [key, value] of Object.entries({
      EVOLUTION_RUNTIME_DIR: previous.runtime,
      EVOLUTION_WORLD_DIR: previous.world,
      EVOLUTION_MODE: previous.mode,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(testRoot, { recursive: true, force: true })
  }
})
