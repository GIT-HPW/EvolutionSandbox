// SPDX-License-Identifier: GPL-3.0-or-later

export class EsipError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = "EsipError"
    this.code = code
    this.details = details
  }
}
