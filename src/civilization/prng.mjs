// SPDX-License-Identifier: GPL-3.0-or-later

const UINT32_MAX = 0xffffffff
const FALLBACK_STATE = 0x6d2b79f5

export function hashText(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string")
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function hashHex(text) {
  return hashText(text).toString(16).padStart(8, "0")
}

export function seedToState(seed) {
  const state = hashText(seed)
  return state === 0 ? FALLBACK_STATE : state
}

export function nextUint32(state) {
  if (!Number.isSafeInteger(state) || state <= 0 || state > UINT32_MAX) {
    throw new TypeError("PRNG state must be an unsigned non-zero 32-bit integer")
  }
  let next = state >>> 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  next >>>= 0
  if (next === 0) next = FALLBACK_STATE
  return { state: next, value: next }
}

export function randomInt(state, maxExclusive) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_MAX) {
    throw new TypeError("maxExclusive must be a positive 32-bit integer")
  }
  const generated = nextUint32(state)
  return { state: generated.state, value: generated.value % maxExclusive }
}
