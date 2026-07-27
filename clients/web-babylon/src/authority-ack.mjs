// SPDX-License-Identifier: GPL-3.0-or-later

export function waitForAuthorityCommit(run) {
  if (typeof run !== "function") throw new TypeError("run must be a function")
  return new Promise((resolve, reject) => {
    let settled = false
    const confirm = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error(String(error ?? "authority execution failed")))
    }
    Promise.resolve()
      .then(() => run({ confirm, fail }))
      .then(() => {
        if (settled) return
        const error = new Error("action finished without an authority commit acknowledgement")
        error.code = "authority_unacknowledged"
        fail(error)
      }, fail)
  })
}
