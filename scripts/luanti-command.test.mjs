// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { buildLuantiServerArgs } from "./luanti-command.mjs"

test("official Luanti client binary is launched in dedicated-server mode", () => {
  const args = ["--world", "runtime/world"]
  assert.deepEqual(buildLuantiServerArgs("C:\\Luanti\\bin\\luanti.exe", args), ["--server", ...args])
  assert.deepEqual(buildLuantiServerArgs("/opt/luanti/bin/luanti", args), ["--server", ...args])
})

test("dedicated-server binary does not receive a duplicate server flag", () => {
  const args = ["--world", "runtime/world"]
  assert.deepEqual(buildLuantiServerArgs("C:\\Luanti\\bin\\luantiserver.exe", args), args)
  assert.deepEqual(buildLuantiServerArgs("/opt/luanti/bin/luantiserver", args), args)
})
