// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { waitForAuthorityCommit } from "../src/authority-ack.mjs"

test("authority acknowledgement resolves before presentation work completes", async () => {
  let finishPresentation
  let presentationCompleted = false
  const presentation = new Promise((resolve) => { finishPresentation = resolve })
  const committed = waitForAuthorityCommit(async ({ confirm }) => {
    confirm({ outcome: "applied", authorityRevision: 8 })
    await presentation
    presentationCompleted = true
  })
  assert.deepEqual(await committed, { outcome: "applied", authorityRevision: 8 })
  assert.equal(presentationCompleted, false)
  finishPresentation()
  await presentation
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(presentationCompleted, true)
})

test("authority acknowledgement rejects failures and missing confirmations", async () => {
  await assert.rejects(
    waitForAuthorityCommit(async ({ fail }) => fail(Object.assign(new Error("rejected"), { code: "authority_rejected" }))),
    (error) => error.code === "authority_rejected",
  )
  await assert.rejects(
    waitForAuthorityCommit(async () => {}),
    (error) => error.code === "authority_unacknowledged",
  )
})
