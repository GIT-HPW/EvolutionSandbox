// SPDX-License-Identifier: GPL-3.0-or-later

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function validateReleaseVersion({ tag, packageVersion, changelog }) {
  const expectedTag = `v${packageVersion}`
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${tag || "<missing>"} must equal package version tag ${expectedTag}`)
  }

  const escapedVersion = packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const heading = new RegExp(`^## ${escapedVersion} - \\d{4}-\\d{2}-\\d{2}$`, "m")
  if (!heading.test(changelog)) {
    throw new Error(`CHANGELOG.md must contain a dated heading for ${packageVersion}`)
  }
  return { packageVersion, tag }
}

export async function checkReleaseVersion(tag, directory = root) {
  const packageJson = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"))
  const changelog = await readFile(resolve(directory, "CHANGELOG.md"), "utf8")
  return validateReleaseVersion({ tag, packageVersion: packageJson.version, changelog })
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : ""
if (invokedPath === fileURLToPath(import.meta.url).toLowerCase()) {
  const result = await checkReleaseVersion(process.argv[2])
  console.log(`Release version verified: ${result.tag}`)
}
