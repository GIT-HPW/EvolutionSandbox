// SPDX-License-Identifier: GPL-3.0-or-later

import { applyAction, createState, statusLine } from "../src/rules-engine.mjs"
import { loadOriginPack } from "../src/load-pack.mjs"

const pack = await loadOriginPack()
let state = createState(pack)

console.log("EvolutionSandbox deterministic demo")
console.log(statusLine(state))
for (const action of pack.demo) {
  const result = applyAction(pack, state, action)
  state = result.state
  console.log(`→ ${result.event.title}: ${result.event.result}`)
  console.log(statusLine(state))
}
if (state.phase !== "first_3d") throw new Error("Demo did not reach the first 3D realm")
console.log("小闭环完成：已从零维原点进入首个三维领域。")
