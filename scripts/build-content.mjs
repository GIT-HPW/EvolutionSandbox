// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { validatePack } from "../src/rules-engine.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const sourcePath = resolve(root, "content", "chapters", "origin.json")
const outputPath = resolve(root, "mods", "evolution_core", "content.generated.lua")

function lua(value, indent = "") {
  if (value === null) return "nil"
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  if (typeof value === "string") return JSON.stringify(value)
  const next = indent + "    "
  if (Array.isArray(value)) {
    if (value.length === 0) return "{}"
    return `{\n${value.map((item) => `${next}${lua(item, next)},`).join("\n")}\n${indent}}`
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) return "{}"
  return `{\n${entries.map(([key, item]) => `${next}[${JSON.stringify(key)}] = ${lua(item, next)},`).join("\n")}\n${indent}}`
}

const pack = validatePack(JSON.parse(await readFile(sourcePath, "utf8")))
const generated = [
  "-- SPDX-License-Identifier: GPL-3.0-or-later",
  "-- Generated from content/chapters/origin.json; run npm run build:content after editing.",
  "return " + lua(pack),
  ""
].join("\n")

if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "")
  if (current !== generated) throw new Error("Generated Lua content is stale; run npm run build:content")
  console.log("Generated Lua content matches origin.json")
} else {
  await writeFile(outputPath, generated, "utf8")
  console.log("Generated " + outputPath)
}
