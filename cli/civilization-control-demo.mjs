// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { CivilizationController, civilizationStatusLine } from "../src/civilization/index.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const spec = JSON.parse(await readFile(resolve(root, "content", "civilizations", "presets", "tidal-archive.json"), "utf8"))
const controller = new CivilizationController(spec, { timelineId: "main", snapshotInterval: 100 })

console.log(`Civilization control demo · ${spec.name}`)
console.log(`created revision=${controller.revision} mode=${controller.snapshot().control.mode}`)

controller.control("set_speed", { speed: 16, expectedRevision: 0 })
controller.control("resume", { expectedRevision: 1 })
controller.pulse({ expectedRevision: 2 })
controller.control("pause", { expectedRevision: 3 })
controller.advance(284, { expectedRevision: 4 })
const main = controller.snapshot().state
console.log(`main · ${civilizationStatusLine(main)}`)

controller.branch("green-path", { atTick: 150, expectedRevision: 5 })
controller.advance(25, { expectedRevision: 6 })
const branch = controller.snapshot().state
console.log(`green-path (branched at 150) · ${civilizationStatusLine(branch)}`)

controller.switchTimeline("main", { expectedRevision: 7 })
assert.deepEqual(controller.snapshot().state, main)
const restored = CivilizationController.restore(spec, controller.exportRecord())
assert.deepEqual(restored.snapshot(), controller.snapshot())
console.log(`restored revision=${restored.revision} timelines=${restored.snapshot().timelines.length} replay=verified`)
