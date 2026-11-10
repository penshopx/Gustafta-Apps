---
name: Portable dependency installation in GitHub CI
description: Workspace lockfiles can retain private Replit registry URLs that GitHub runners cannot resolve.
---

Treat npm lockfiles generated in the workspace as potentially nonportable to GitHub-hosted runners. Changing `.npmrc` alone does not change tarball URLs already recorded in a lockfile.

**Why:** A GitHub install reported an npm internal exit-handler error, appeared successful to the workflow, and left runtime packages unavailable. Existing lockfile URLs pointed to the workspace-only registry.

**How to apply:** Preserve locked versions, integrity values, and dependency metadata when preparing the CI checkout for a publicly reachable registry. Do not rewrite the workspace registry or bypass an actual package-security rejection. Verify that required modules can be imported after installation instead of trusting the install command's exit code alone.
