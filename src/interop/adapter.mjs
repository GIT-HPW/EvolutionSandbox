// SPDX-License-Identifier: GPL-3.0-or-later

import { createMessage } from "./envelope.mjs"
import { EsipError } from "./errors.mjs"
import { ESIP_VERSION, MESSAGE_DEFINITIONS, TYPES, typeMatches } from "./message-types.mjs"

function validatePatterns(values, name) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError(`${name} must be an array of message type patterns`)
  }
}

export class EsipAdapter {
  #router
  #sequence
  #unsubscribers = []

  constructor({
    id,
    source,
    platform,
    consumes = [],
    produces = [],
    handle = async () => {},
    maxMessageBytes = 64 * 1024,
    initialSequence = 0,
    sequenceChanged = () => {},
    definitions = MESSAGE_DEFINITIONS,
  }) {
    if (typeof id !== "string" || typeof source !== "string" || typeof platform !== "string") {
      throw new TypeError("Adapter id, source and platform are required")
    }
    validatePatterns(consumes, "consumes")
    validatePatterns(produces, "produces")
    if (typeof handle !== "function") throw new TypeError("handle must be a function")
    if (!Number.isSafeInteger(initialSequence) || initialSequence < 0) throw new TypeError("initialSequence must be a non-negative integer")
    if (typeof sequenceChanged !== "function") throw new TypeError("sequenceChanged must be a function")
    this.id = id
    this.source = source
    this.platform = platform
    this.consumes = [...consumes]
    this.produces = [...produces]
    this.handle = handle
    this.maxMessageBytes = maxMessageBytes
    this.#sequence = initialSequence
    this.sequenceChanged = sequenceChanged
    this.definitions = definitions
  }

  async connect(router) {
    if (this.#router) throw new EsipError("adapter_connected", `${this.id} is already connected`)
    this.#router = router
    for (const pattern of this.consumes) {
      this.#unsubscribers.push(router.subscribe(pattern, async (message) => {
        if (message.target && message.target !== this.source && message.target !== this.id) return
        return this.handle(message, {
          emit: (type, kind, data, options = {}) => this.emit(type, kind, data, options),
          adapter: this,
        })
      }))
    }
    try {
      return await this.emit(TYPES.CAPABILITY_HELLO, "event", {
        adapterId: this.id,
        platform: this.platform,
        protocolVersions: [ESIP_VERSION],
        consumes: this.consumes,
        produces: this.produces,
        maxMessageBytes: this.maxMessageBytes,
      }, { allowInternal: true })
    } catch (error) {
      this.disconnect()
      throw error
    }
  }

  async emit(type, kind, data, options = {}) {
    if (!this.#router) throw new EsipError("adapter_disconnected", `${this.id} is not connected`)
    const allowed = options.allowInternal || this.produces.some((pattern) => typeMatches(pattern, type))
    if (!allowed) throw new EsipError("capability_violation", `${this.id} did not declare production of ${type}`)
    const sequence = this.#sequence++
    await this.sequenceChanged(this.#sequence)
    const message = createMessage({
      ...options,
      source: this.source,
      type,
      kind,
      sequence,
      data,
    }, { definitions: this.definitions })
    return this.#router.publish(message)
  }

  disconnect() {
    for (const unsubscribe of this.#unsubscribers) unsubscribe()
    this.#unsubscribers = []
    this.#router = undefined
  }

  get nextSequence() {
    return this.#sequence
  }
}
