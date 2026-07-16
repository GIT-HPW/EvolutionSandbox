// SPDX-License-Identifier: GPL-3.0-or-later

import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import luaparse from "luaparse"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const files = []

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name)
    if (entry.isDirectory()) await walk(target)
    else if (entry.name.endsWith(".lua")) files.push(target)
  }
}

await walk(join(root, "mods"))
for (const file of files) {
  const source = await readFile(file, "utf8")
  luaparse.parse(source, { luaVersion: "5.1", comments: false })
  if (!source.includes("SPDX-License-Identifier: GPL-3.0-or-later")) {
    throw new Error("Missing SPDX header: " + file)
  }
}
console.log("Lua syntax and license headers verified: " + files.length + " files")
