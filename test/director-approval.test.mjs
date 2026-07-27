// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import {
  createDirectorApprovalGate,
  decideDirectorGoal,
  validateDirectorApprovalRecord,
} from "../src/director/index.mjs"

function observation(overrides = {}) {
  return {
    sceneId: "origin",
    phase: "first_3d",
    stateRevision: 7,
    availableActions: ["observe", "create", "destroy", "stabilize"],
    completedMilestones: ["realm_anchored"],
    availableScenes: ["origin", "stellar"],
    ...overrides,
  }
}

function proposal({ goal = "观察宇宙", requestId = "director-goal-1", current = observation(), decisionRevision = 1 } = {}) {
  const context = {
    universeId: "universe-1",
    timelineId: "origin",
    realmId: current.phase,
    actorId: "director-player",
  }
  return {
    requestId,
    context,
    observation: current,
    decision: {
      context,
      respondingTo: requestId,
      revision: decisionRevision,
      ...decideDirectorGoal({ goal, observation: current }),
    },
  }
}

function clock() {
  let tick = 0
  return () => `2026-07-23T00:00:${String(tick++).padStart(2, "0")}.000Z`
}

test("approval gate stages a proposal without authority writes and executes it only after actor approval", async () => {
  let actions = 0
  const events = []
  const current = observation()
  const gate = createDirectorApprovalGate({
    observe: async () => current,
    executeAction: async (plan) => {
      actions += 1
      assert.equal(plan.actionId, "observe")
      assert.equal(plan.expectedStateRevision, 7)
      return { authorityRevision: 8, outcome: "applied" }
    },
    approvalChanged: async (_record, event) => events.push(event.type),
    now: clock(),
  })

  const ticket = await gate.stage(proposal())
  assert.equal(ticket.status, "pending")
  assert.equal(actions, 0)
  assert.equal(gate.revision, 1)

  const executed = await gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" })
  assert.equal(executed.status, "executed")
  assert.equal(executed.execution.plan.type, "action_command")
  assert.deepEqual(executed.execution.result, { authorityRevision: 8, outcome: "applied" })
  assert.equal(actions, 1)
  assert.equal(gate.revision, 3)
  assert.deepEqual(events, ["ticket_staged", "ticket_execution_started", "ticket_execution_completed"])

  const replay = await gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" })
  assert.equal(replay.status, "executed")
  assert.equal(actions, 1)
  assert.equal(gate.revision, 3)
})

test("actor can decline a ticket without calling an authority executor", async () => {
  let writes = 0
  const gate = createDirectorApprovalGate({
    observe: async () => observation(),
    executeAction: async () => { writes += 1 },
    now: clock(),
  })
  const ticket = await gate.stage(proposal())
  const declined = await gate.review(ticket.ticketId, { choice: "decline", reviewerId: "director-player" })
  assert.equal(declined.status, "declined")
  assert.equal(declined.execution, null)
  assert.equal(writes, 0)
  await assert.rejects(
    gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" }),
    (error) => error.code === "ticket_closed",
  )
})

test("approval fails closed when authority state changed or reviewer identity is not bound", async () => {
  let writes = 0
  const gate = createDirectorApprovalGate({
    observe: async () => observation({ stateRevision: 8 }),
    executeAction: async () => { writes += 1 },
    now: clock(),
  })
  const ticket = await gate.stage(proposal())
  await assert.rejects(
    gate.review(ticket.ticketId, { choice: "approve", reviewerId: "another-player" }),
    (error) => error.code === "reviewer_forbidden",
  )
  await assert.rejects(
    gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" }),
    (error) => error.code === "stale_observation",
  )
  assert.equal(gate.getTicket(ticket.ticketId).status, "pending")
  assert.equal(writes, 0)
  assert.equal(gate.revision, 1)
})

test("scene transition approval creates a permit only after rechecking milestone and build availability", async () => {
  const current = observation()
  let received
  const gate = createDirectorApprovalGate({
    observe: async () => current,
    prepareSceneTransition: async (plan) => {
      received = plan
      return { checkpointRequired: true, navigationPerformed: false }
    },
    now: clock(),
  })
  const ticket = await gate.stage(proposal({ goal: "让宇宙进入星辰时代" }))
  const executed = await gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" })
  assert.equal(received.type, "scene_transition_permit")
  assert.equal(received.fromScene, "origin")
  assert.equal(received.toScene, "stellar")
  assert.equal(received.mode, "manual_confirm")
  assert.equal(executed.execution.result.navigationPerformed, false)
})

test("executor failure is audited and the ticket cannot execute twice", async () => {
  let calls = 0
  const gate = createDirectorApprovalGate({
    observe: async () => observation(),
    executeAction: async () => {
      calls += 1
      const error = new Error("simulated authority rejection")
      error.code = "authority_rejected"
      throw error
    },
    now: clock(),
  })
  const ticket = await gate.stage(proposal())
  await assert.rejects(
    gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" }),
    (error) => error.code === "execution_failed",
  )
  assert.equal(gate.getTicket(ticket.ticketId).status, "failed")
  assert.deepEqual(gate.getTicket(ticket.ticketId).execution.error, {
    code: "authority_rejected",
    message: "simulated authority rejection",
  })
  const replay = await gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" })
  assert.equal(replay.status, "failed")
  assert.equal(calls, 1)
})

test("successful authority execution with failed final persistence requires reconciliation", async () => {
  let writes = 0
  let persistenceCall = 0
  const gate = createDirectorApprovalGate({
    observe: async () => observation(),
    executeAction: async () => { writes += 1; return { outcome: "applied" } },
    approvalChanged: async () => {
      persistenceCall += 1
      if (persistenceCall === 3) throw new Error("simulated final storage failure")
    },
    now: clock(),
  })
  const ticket = await gate.stage(proposal())
  await assert.rejects(
    gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" }),
    (error) => error.code === "reconciliation_required",
  )
  assert.equal(writes, 1)
  assert.equal(gate.getTicket(ticket.ticketId).status, "executing")
  await assert.rejects(
    gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" }),
    (error) => error.code === "reconciliation_required",
  )
  assert.equal(writes, 1)
})

test("approval records restore terminal tickets and reject inconsistent audit state", async () => {
  const gate = createDirectorApprovalGate({ observe: async () => observation(), executeAction: async () => ({ ok: true }), now: clock() })
  const ticket = await gate.stage(proposal())
  await gate.review(ticket.ticketId, { choice: "approve", reviewerId: "director-player" })
  const restored = createDirectorApprovalGate({ record: gate.record, observe: async () => observation(), now: clock() })
  assert.equal(restored.getTicket(ticket.ticketId).status, "executed")
  assert.equal(restored.revision, 3)

  const corrupt = gate.record
  corrupt.tickets[0].execution.plan.expectedStateRevision = 999
  assert.throws(() => validateDirectorApprovalRecord(corrupt), (error) => error.code === "invalid_approval")
})

test("rejected or mismatched director decisions never enter approval", async () => {
  const gate = createDirectorApprovalGate({ observe: async () => observation(), now: clock() })
  const rejected = proposal({ goal: "现在建立文明" })
  await assert.rejects(gate.stage(rejected), (error) => error.code === "decision_not_proposed")

  const mismatched = proposal()
  mismatched.decision.respondingTo = "another-request"
  await assert.rejects(gate.stage(mismatched), (error) => error.code === "decision_mismatch")
  assert.equal(gate.revision, 0)
})

test("repeated deterministic intents remain separate when they come from different director requests", async () => {
  const gate = createDirectorApprovalGate({ observe: async () => observation(), now: clock() })
  const first = await gate.stage(proposal({ requestId: "director-repeat-1", decisionRevision: 1 }))
  const second = await gate.stage(proposal({ requestId: "director-repeat-2", decisionRevision: 2 }))
  assert.equal(first.intent.intentId, second.intent.intentId)
  assert.notEqual(first.ticketId, second.ticketId)
  assert.equal(gate.pendingTickets.length, 2)
  assert.equal(gate.revision, 2)
})
