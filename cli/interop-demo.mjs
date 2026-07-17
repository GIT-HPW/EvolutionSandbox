// SPDX-License-Identifier: GPL-3.0-or-later

import { statusLine } from "../src/rules-engine.mjs"
import { loadOriginPack } from "../src/load-pack.mjs"
import { EsipAdapter, MemoryRouter, TYPES, createEvolutionRulesAdapter } from "../src/interop/index.mjs"

const LUANTI_SOURCE = "esip://luanti/world-alpha"
const WEB_SOURCE = "esip://web/control-panel"
const received = []
const pack = await loadOriginPack()

const router = new MemoryRouter({
  authorize(message) {
    if (message.kind === "event" || message.kind === "result") return true
    return message.source === WEB_SOURCE
      && message.target === LUANTI_SOURCE
      && (message.type === TYPES.ACTION_REQUESTED || message.type === TYPES.STATE_REQUESTED)
  },
})

const luanti = createEvolutionRulesAdapter({ pack, source: LUANTI_SOURCE })
const controlPanel = new EsipAdapter({
  id: "web-control-panel",
  source: WEB_SOURCE,
  platform: "web",
  consumes: [TYPES.ACTION_APPLIED, TYPES.STATE_SNAPSHOT, TYPES.REALM_TRANSITIONED, TYPES.ERROR],
  produces: [TYPES.ACTION_REQUESTED, TYPES.STATE_REQUESTED],
  handle: async (message) => received.push(message),
})

await luanti.connect(router)
await controlPanel.connect(router)

const context = () => ({
  universeId: "universe-1",
  timelineId: luanti.stateSnapshot.timeline,
  realmId: luanti.stateSnapshot.phase,
  actorId: "demo-player",
})

console.log("ESIP 0.1 in-memory cross-platform demo")
for (const actionId of pack.demo) {
  await controlPanel.emit(TYPES.ACTION_REQUESTED, "command", {
    context: context(),
    actionId,
    parameters: {},
    expectedRevision: luanti.revision,
  }, {
    subject: "actor/demo-player",
    target: LUANTI_SOURCE,
    correlationid: "origin-demo",
  })
  const latest = received.at(-1)
  if (latest.type === TYPES.ERROR) throw new Error(latest.data.message)
  console.log(`→ ${actionId} acknowledged at revision ${luanti.revision}`)
}

await controlPanel.emit(TYPES.STATE_REQUESTED, "query", {
  context: context(),
  fields: ["phase", "dimension", "energy", "information", "entropy"],
}, {
  subject: "actor/demo-player",
  target: LUANTI_SOURCE,
  correlationid: "origin-demo",
})

const snapshot = received.findLast((message) => message.type === TYPES.STATE_SNAPSHOT)
if (!snapshot || snapshot.data.state.phase !== "first_3d") throw new Error("ESIP demo did not reach first_3d")
console.log(statusLine(snapshot.data.state))
console.log(`Completed: ${received.length} targeted messages received; duplicate/replay controls enabled.`)
