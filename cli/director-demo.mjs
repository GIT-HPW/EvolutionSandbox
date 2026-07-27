// SPDX-License-Identifier: GPL-3.0-or-later

import { EsipAdapter, MemoryRouter, TYPES, createDirectorAdapter } from "../src/interop/index.mjs"

const DIRECTOR_SOURCE = "esip://evolution/director-alpha"
const CONTROL_SOURCE = "esip://local/director-control"
const received = []
const suppliedGoal = process.argv.slice(2).join(" ").trim()
const goals = suppliedGoal.length > 0
  ? [suppliedGoal]
  : ["继续观察这个新生宇宙", "让宇宙进入星辰时代", "现在直接建立文明"]

const router = new MemoryRouter({
  authorize(message) {
    if (message.kind === "event" || message.kind === "result") return true
    return message.source === CONTROL_SOURCE
      && message.target === DIRECTOR_SOURCE
      && message.type === TYPES.DIRECTOR_GOAL_REQUESTED
  },
})

const director = createDirectorAdapter({
  source: DIRECTOR_SOURCE,
  bindings: [{ source: CONTROL_SOURCE, actorId: "director-player", universeId: "universe-1" }],
})
const control = new EsipAdapter({
  id: "director-demo-control",
  source: CONTROL_SOURCE,
  platform: "local-cli",
  consumes: [TYPES.DIRECTOR_DECIDED, TYPES.ERROR],
  produces: [TYPES.DIRECTOR_GOAL_REQUESTED],
  handle: async (message) => received.push(message),
})

await director.connect(router)
await control.connect(router)

const context = {
  universeId: "universe-1",
  timelineId: "origin",
  realmId: "first_3d",
  actorId: "director-player",
}
const observation = {
  sceneId: "origin",
  phase: "first_3d",
  stateRevision: 7,
  availableActions: ["observe", "create", "destroy", "stabilize"],
  completedMilestones: ["realm_anchored"],
  availableScenes: ["origin", "stellar"],
}

console.log("本地确定性导演演示（不调用外部模型，不修改游戏权威状态）")
for (const [index, goal] of goals.entries()) {
  await control.emit(TYPES.DIRECTOR_GOAL_REQUESTED, "command", {
    context,
    goal,
    observation,
    expectedDirectorRevision: director.directorRevision,
  }, {
    id: `director-demo-${index + 1}`,
    target: DIRECTOR_SOURCE,
    subject: "actor/director-player",
    correlationid: "director-local-demo",
  })
  const response = received.at(-1)
  if (response.type === TYPES.ERROR) throw new Error(`${response.data.code}: ${response.data.message}`)
  const intent = response.data.intent
  console.log(`\n目标：${goal}`)
  console.log(`结果：${response.data.outcome} / ${response.data.reasonCode} / revision ${response.data.revision}`)
  console.log(intent ? `意图：${intent.type} / ${intent.title}` : `拒绝：${response.data.explanation}`)
  console.log(`审计：${response.data.audit.policyId} / ${response.data.audit.ruleId} / ${response.data.audit.requestHash}`)
}
console.log(`\n完成：${received.length} 个目标均经过 ESIP；游戏权威状态写入次数为 0。`)
