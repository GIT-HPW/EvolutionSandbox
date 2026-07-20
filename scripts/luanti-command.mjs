// SPDX-License-Identifier: GPL-3.0-or-later

import { basename } from "node:path"

const CLIENT_BINARY_NAMES = new Set(["luanti", "luanti.exe", "minetest", "minetest.exe"])

export function buildLuantiServerArgs(binary, args) {
  const name = basename(binary).toLowerCase()
  return CLIENT_BINARY_NAMES.has(name) ? ["--server", ...args] : args
}
