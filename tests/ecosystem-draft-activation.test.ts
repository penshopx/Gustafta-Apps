import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const name of ["ecosystem-link-health", "ecosystem-monitor-watchdog", "ecosystem-cronitor-config-audit"]) {
  test(`${name}: draf manual tanpa pemicu jadwal atau workflow otomatis`, () => {
    const workflow = readFileSync(`.github/workflows/${name}.yml`, "utf8");
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
    assert.match(triggers, /workflow_dispatch:/);
    assert.doesNotMatch(triggers, /^\s{2}(schedule|workflow_run|push|pull_request|pull_request_target):/m);
    if (name !== "ecosystem-cronitor-config-audit") {
      assert.match(triggers, /allow_operational_run:[\s\S]*?type: boolean\n\s+default: false/);
      assert.match(workflow, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.allow_operational_run == true \}\}/);
    } else {
      const heartbeatGates = [...workflow.matchAll(/if: \$\{\{ github\.event_name == 'schedule' && vars\.ECOSYSTEM_CONFIG_AUDIT_HEARTBEATS_ENABLED == 'true' \}\}/g)];
      assert.equal(heartbeatGates.length, 2, "audit timers need explicit approval as well as a scheduled event");
      assert.doesNotMatch(triggers, /inputs:|allow_operational_run:/, "manual audit must not offer a ping/alert override");
    }
  });
}
