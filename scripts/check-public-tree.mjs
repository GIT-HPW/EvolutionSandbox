// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const excludedDirectories = new Set([".git", "node_modules", "runtime", "dist"])
const files = []
let checkingGitFiles = false

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else files.push(path)
  }
}

try {
  const gitRoot = resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
  }).trim())
  if (gitRoot.toLowerCase() === root.toLowerCase()) {
    checkingGitFiles = true
    const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root, encoding: "utf8"
    })
    for (const path of listed.split("\0").filter(Boolean)) files.push(resolve(root, path))
  } else await walk(root)
} catch {
  await walk(root)
}

const forbiddenPath = /(^|\/)(\.env|[^/]+\.(sqlite|sqlite3|log|pem|key|tgz|tar\.gz))$/i
const secretPattern = /sk-ant-[A-Za-z0-9_-]{12,}|sk-proj-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|github_pat_[0-9A-Za-z_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/
const absolutePathPattern = /[A-Za-z]:\\[^\r\n]*(?:virFactory|EvolutionSandbox)|\/(?:home|Users)\/[^\r\n]*(?:virFactory|EvolutionSandbox)/i

for (const path of files) {
  const portable = relative(root, path).split(sep).join("/")
  if (forbiddenPath.test("/" + portable)) throw new Error("Forbidden public file: " + portable)
  const content = await readFile(path, "utf8")
  if (secretPattern.test(content)) throw new Error("Possible secret in public file: " + portable)
  if (absolutePathPattern.test(content)) throw new Error("Local absolute path in public file: " + portable)
}
console.log(`Public tree guard passed: ${files.length} ${checkingGitFiles ? "Git-visible" : "source"} files inspected`)
