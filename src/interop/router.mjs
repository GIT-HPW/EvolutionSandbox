// SPDX-License-Identifier: GPL-3.0-or-later

import { EsipError } from "./errors.mjs"
import { MESSAGE_DEFINITIONS, typeMatches } from "./message-types.mjs"
import { validateMessage } from "./validation.mjs"

const encoder = new TextEncoder()

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export class MemoryRouter {
  #subscriptions = new Set()
  #seen = new Map()
  #lastSequence = new Map()

  constructor({
    authorize = (message) => message.kind === "event" || message.kind === "result",
    maxMessageBytes = 64 * 1024,
    seenLimit = 10_000,
    strictSequence = true,
    now = () => Date.now(),
    definitions = MESSAGE_DEFINITIONS,
  } = {}) {
    if (typeof authorize !== "function") throw new TypeError("authorize must be a function")
    this.authorize = authorize
    this.maxMessageBytes = maxMessageBytes
    this.seenLimit = seenLimit
    this.strictSequence = strictSequence
    this.now = now
    this.definitions = definitions
  }

  subscribe(pattern, handler) {
    if (typeof pattern !== "string" || typeof handler !== "function") throw new TypeError("Invalid subscription")
    const subscription = { pattern, handler }
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  async publish(rawMessage) {
    let serialized
    try { serialized = JSON.stringify(rawMessage) } catch { throw new EsipError("invalid_message", "message must be JSON serializable") }
    const bytes = encoder.encode(serialized).byteLength
    if (bytes > this.maxMessageBytes) {
      throw new EsipError("message_too_large", `message is ${bytes} bytes; limit is ${this.maxMessageBytes}`)
    }

    const message = validateMessage(structuredClone(rawMessage), { now: this.now(), definitions: this.definitions })
    const fingerprint = JSON.stringify(canonicalize(message))
    const seenKey = message.source + "\u0000" + message.id
    const previous = this.#seen.get(seenKey)
    if (previous !== undefined) {
      if (previous !== fingerprint) throw new EsipError("id_conflict", "message id was reused with different content")
      return { accepted: false, duplicate: true, deliveries: [] }
    }

    const authorized = await this.authorize(message)
    if (!authorized) throw new EsipError("forbidden", `${message.kind} message is not authorized`)

    const last = this.#lastSequence.get(message.source)
    if (this.strictSequence && last !== undefined && message.sequence <= last) {
      throw new EsipError("sequence_replay", `sequence ${message.sequence} is not newer than ${last}`)
    }

    this.#seen.set(seenKey, fingerprint)
    while (this.#seen.size > this.seenLimit) this.#seen.delete(this.#seen.keys().next().value)
    this.#lastSequence.set(message.source, message.sequence)

    const matches = [...this.#subscriptions].filter(({ pattern }) => typeMatches(pattern, message.type))
    const deliveries = await Promise.allSettled(matches.map(({ handler }) => handler(structuredClone(message))))
    return { accepted: true, duplicate: false, deliveries }
  }
}
