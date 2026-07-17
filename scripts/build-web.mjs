// SPDX-License-Identifier: GPL-3.0-or-later

import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const site = resolve(root, "dist", "site")

await rm(site, { recursive: true, force: true })
await mkdir(site, { recursive: true })
await cp(resolve(root, "web"), site, { recursive: true })
await cp(resolve(root, "src", "rules-engine.mjs"), resolve(site, "rules-engine.mjs"))
await cp(resolve(root, "content", "chapters", "origin.json"), resolve(site, "origin.json"))
await mkdir(resolve(site, "esip"), { recursive: true })
await cp(resolve(root, "protocol", "schemas"), resolve(site, "esip", "schemas"), { recursive: true })
await cp(resolve(root, "protocol", "asyncapi.json"), resolve(site, "esip", "asyncapi.json"))
console.log("Browser demo built at dist/site")
