// SPDX-License-Identifier: GPL-3.0-or-later

import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Ajv2020 from "ajv/dist/2020.js"
import { MESSAGE_DEFINITIONS, schemaUrlFor } from "../src/interop/message-types.mjs"
import { validateMessage } from "../src/interop/validation.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const schemaDirectory = resolve(root, "protocol", "schemas")
const exampleDirectory = resolve(root, "protocol", "examples")
const schemaFiles = (await readdir(schemaDirectory)).filter((name) => name.endsWith(".json")).sort()
const schemas = await Promise.all(schemaFiles.map(async (name) => JSON.parse(await readFile(join(schemaDirectory, name), "utf8"))))
const ajv = new Ajv2020({ allErrors: true, strict: true })
for (const schema of schemas) ajv.addSchema(schema)

const envelope = schemas.find((schema) => schema.title?.startsWith("ESIP 0.1"))
if (!envelope) throw new Error("Envelope schema is missing")
const validateEnvelopeSchema = ajv.getSchema(envelope.$id)
const examples = (await readdir(exampleDirectory)).filter((name) => name.endsWith(".json")).sort()
const coveredTypes = new Set()

for (const name of examples) {
  const message = JSON.parse(await readFile(join(exampleDirectory, name), "utf8"))
  if (!validateEnvelopeSchema(message)) throw new Error(`${name} envelope: ${ajv.errorsText(validateEnvelopeSchema.errors)}`)
  validateMessage(message, { now: Date.parse("2026-07-17T00:00:00.000Z") })
  const definition = MESSAGE_DEFINITIONS[message.type]
  coveredTypes.add(message.type)
  const payloadValidator = ajv.getSchema(schemaUrlFor(message.type))
  if (!definition || !payloadValidator) throw new Error(`${name} references an unknown message type or schema`)
  if (!payloadValidator(message.data)) throw new Error(`${name} payload: ${ajv.errorsText(payloadValidator.errors)}`)
  if (message.dataschema !== schemaUrlFor(message.type)) throw new Error(`${name} dataschema does not match its type`)
}

const asyncApi = JSON.parse(await readFile(resolve(root, "protocol", "asyncapi.json"), "utf8"))
if (asyncApi.asyncapi !== "3.0.0" || asyncApi.info?.version !== "0.1.0") throw new Error("AsyncAPI version metadata is invalid")
const channelAddresses = new Set(Object.values(asyncApi.channels ?? {}).map((channel) => channel.address))
for (const type of Object.keys(MESSAGE_DEFINITIONS)) {
  if (!channelAddresses.has(type)) throw new Error(`AsyncAPI is missing channel ${type}`)
  if (!coveredTypes.has(type)) throw new Error(`Protocol examples are missing ${type}`)
}
console.log(`ESIP protocol verified: ${schemas.length} schemas, ${examples.length} examples, ${channelAddresses.size} channels`)
