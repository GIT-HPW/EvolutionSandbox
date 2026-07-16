// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validatePack } from "./rules-engine.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export async function loadOriginPack() {
  const source = await readFile(resolve(root, "content", "chapters", "origin.json"), "utf8")
  return validatePack(JSON.parse(source))
}
