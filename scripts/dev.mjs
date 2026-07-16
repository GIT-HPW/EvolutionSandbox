// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn } from "node:child_process"
import { prepareRuntime } from "./prepare-runtime.mjs"

const runtime = await prepareRuntime()
const server = spawn(runtime.luantiBinary, [
  "--world", runtime.worldDir,
  "--config", runtime.configPath,
  "--gameid", runtime.gameId,
  "--port", runtime.luantiPort,
], {
  cwd: runtime.root,
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
})

server.once("error", (error) => {
  console.error("Luanti failed to start: " + error.message)
  console.error("Set LUANTI_SERVER_BIN to the full luantiserver path, then retry npm run dev.")
  process.exitCode = 1
})
server.once("exit", (code, signal) => {
  if (signal) console.log("Luanti stopped by " + signal)
  process.exitCode = code ?? 0
})
process.on("SIGINT", () => server.kill("SIGTERM"))
process.on("SIGTERM", () => server.kill("SIGTERM"))
