// SPDX-License-Identifier: GPL-3.0-or-later

import { createHttpSidecar } from "../src/interop/index.mjs"

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

const sidecar = createHttpSidecar({
  token,
  host,
  port,
  luantiSource,
  luantiAdapterId,
  allowedCommandSources,
})
const address = await sidecar.listen()
const displayHost = address.host.includes(":") ? `[${address.host}]` : address.host

console.log(`Evolution ESIP sidecar listening on http://${displayHost}:${address.port}`)
console.log(`Luanti target: ${luantiSource}`)
console.log(`Allowed command sources: ${allowedCommandSources.join(", ")}`)
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
