// SPDX-License-Identifier: GPL-3.0-or-later

import { CLOUD_EVENTS_VERSION, ESIP_VERSION, MESSAGE_DEFINITIONS, schemaUrlFor } from "./message-types.mjs"
import { validateMessage } from "./validation.mjs"

function defaultId() {
  return globalThis.crypto.randomUUID()
}

export function createMessage(input, { now = () => new Date(), idFactory = defaultId, definitions = MESSAGE_DEFINITIONS } = {}) {
  const instant = now()
  const message = {
    specversion: CLOUD_EVENTS_VERSION,
    esipversion: ESIP_VERSION,
    id: input.id ?? idFactory(),
    source: input.source,
    type: input.type,
    kind: input.kind,
    time: instant instanceof Date ? instant.toISOString() : new Date(instant).toISOString(),
    subject: input.subject,
    target: input.target,
    datacontenttype: "application/json",
    dataschema: input.dataschema ?? definitions[input.type]?.dataschema ?? schemaUrlFor(input.type),
    sequence: input.sequence,
    tick: input.tick,
    correlationid: input.correlationid,
    causationid: input.causationid,
    expiresat: input.expiresat,
    data: structuredClone(input.data),
  }
  for (const key of Object.keys(message)) if (message[key] === undefined) delete message[key]
  return validateMessage(message, {
    now: instant instanceof Date ? instant.getTime() : Date.parse(instant),
    definitions,
  })
}
