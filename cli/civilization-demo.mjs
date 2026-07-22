// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { civilizationStatusLine, runCivilization } from "../src/civilization/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const presetName = process.argv[2] ?? "tidal-archive"
if (!/^[a-z][a-z0-9-]{0,63}$/.test(presetName)) throw new Error("Preset name is invalid")
const presetPath = resolve(root, "content", "civilizations", "presets", presetName + ".json")
const spec = JSON.parse(await readFile(presetPath, "utf8"))
const requestedTicks = process.argv[3] === undefined ? spec.stopConditions.maxTicks : Number(process.argv[3])
if (!Number.isSafeInteger(requestedTicks)) throw new Error("Ticks must be an integer")

const result = runCivilization(spec, { ticks: requestedTicks })
const important = result.events.filter((event) => event.type === "era_transition" || event.type.endsWith("completed") || event.type.endsWith("collapsed"))
const recent = result.events.slice(-5)
const visibleEvents = [...new Map([...important, ...recent].map((event) => [event.cursor, event])).values()]

console.log(`Civilization deterministic demo · ${spec.name}`)
console.log(`seed=${spec.seed} mode=${spec.autonomy.mode} maxTicks=${spec.stopConditions.maxTicks}`)
console.log(civilizationStatusLine(result.state))
console.log(`events=${result.events.length} milestones=${result.state.milestones.map((entry) => `${entry.id}@${entry.tick}`).join(",")}`)
for (const event of visibleEvents) console.log(`→ #${event.cursor} tick ${event.tick}: ${event.title} [${event.type}]`)
