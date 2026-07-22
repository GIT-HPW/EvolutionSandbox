// SPDX-License-Identifier: GPL-3.0-or-later

import { readdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import { validateCivilizationSpec } from "../src/civilization/validation.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaPath = resolve(root, "content", "schemas", "civilization-spec.schema.json")
const presetDirectory = resolve(root, "content", "civilizations", "presets")
const schema = JSON.parse(await readFile(schemaPath, "utf8"))
const ajv = new Ajv2020({ allErrors: true, strict: true })
const validateSchema = ajv.compile(schema)
const files = (await readdir(presetDirectory)).filter((name) => name.endsWith(".json")).sort()
if (files.length === 0) throw new Error("At least one civilization preset is required")

const ids = new Set()
const seeds = new Set()
for (const file of files) {
  const preset = JSON.parse(await readFile(resolve(presetDirectory, file), "utf8"))
  if (!validateSchema(preset)) {
    throw new Error(`${file} does not match CivilizationSpec: ${ajv.errorsText(validateSchema.errors)}`)
  }
  const normalized = validateCivilizationSpec(preset)
  const expectedFile = normalized.id.replaceAll("_", "-") + ".json"
  if (file !== expectedFile) throw new Error(`${file} must be named ${expectedFile}`)
  if (ids.has(normalized.id)) throw new Error(`Duplicate civilization id: ${normalized.id}`)
  if (seeds.has(normalized.seed)) throw new Error(`Duplicate civilization seed: ${normalized.seed}`)
  ids.add(normalized.id)
  seeds.add(normalized.seed)
}

console.log(`Civilization content verified: ${files.length} presets, schema ${schema.properties.schemaVersion.const}`)
