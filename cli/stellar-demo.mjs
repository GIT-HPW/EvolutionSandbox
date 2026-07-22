// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runStellarSystem, stellarStatusLine } from "../src/stellar/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const presetName = process.argv[2] ?? "first-light"
if (!/^[a-z][a-z0-9-]{0,63}$/.test(presetName)) throw new Error("Preset name is invalid")
const spec = JSON.parse(await readFile(resolve(root, "content", "stellar", "presets", presetName + ".json"), "utf8"))
const requestedTicks = process.argv[3] === undefined ? spec.stopConditions.maxTicks : Number(process.argv[3])
if (!Number.isSafeInteger(requestedTicks)) throw new Error("Ticks must be an integer")

const result = runStellarSystem(spec, { ticks: requestedTicks })
console.log(`Stellar deterministic demo · ${spec.name}`)
console.log(`seed=${spec.seed} source=${spec.source.chapter} maxTicks=${spec.stopConditions.maxTicks}`)
console.log(stellarStatusLine(result.state))
console.log(`events=${result.events.length} milestones=${result.state.milestones.map((entry) => `${entry.id}@${entry.tick}`).join(",")}`)
for (const event of result.events.filter((entry) => entry.type === "stellar_transition" || entry.type.endsWith("completed") || entry.type === "stellar_explosion")) {
  console.log(`→ #${event.cursor} tick ${event.tick}: ${event.title} [${event.type}]`)
}
