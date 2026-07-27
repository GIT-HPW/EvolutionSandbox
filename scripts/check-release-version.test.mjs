// SPDX-License-Identifier: GPL-3.0-or-later

import assert from "node:assert/strict"
import test from "node:test"
import { validateReleaseVersion } from "./check-release-version.mjs"

const changelog = "# Changelog\n\n## 0.5.0 - 2026-07-20\n\n- Stable.\n"

test("release tag must match package version and dated changelog heading", () => {
  assert.deepEqual(validateReleaseVersion({
    tag: "v0.5.0",
    packageVersion: "0.5.0",
    changelog,
  }), { tag: "v0.5.0", packageVersion: "0.5.0" })

  assert.throws(() => validateReleaseVersion({
    tag: "v0.6.0",
    packageVersion: "0.5.0",
    changelog,
  }), /must equal package version/)

  assert.throws(() => validateReleaseVersion({
    tag: "v0.5.0",
    packageVersion: "0.5.0",
    changelog: "# Changelog\n\n## Unreleased\n",
  }), /dated heading/)
})
