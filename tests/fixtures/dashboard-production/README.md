# Dashboard production smoke check

Run `npm run check:dashboard-production` and `npm run test:dashboard-production`.
The browser check needs `CHROME_PATH` or `chromium` on PATH; it fails rather than
skipping if Chromium is unavailable.

The fixture compiles the **real Dashboard and all its real lazy imports** using
the application's Vite production configuration. Its entry supplies the normal
providers and a preseeded query cache, not replacement panels or mocked hooks.
This is a dashboard integration build, not the entire App/router or a backend
authorization test. The existing `dashboard-loading.vitest.tsx` still covers
the deferred Chat Console lifecycle and popup draft retention.

The two fresh browser contexts represent an admin and a non-admin owner with the
same paid plan. Both can open the existing dashboard navigation and owner edit/
sharing dialogs. Admin status reads receive fixture HTTP 200 versus HTTP 403 for
non-admin; the latter must not remove the dashboard shell or redirect the user.
These are the existing UI semantics, not a new permission policy.

Checks cover all 22 lazy dashboard panels, including the real Chat Console and
Knowledge Base, and profile/agent/module/toolbox edit and sharing dialogs.
The panel matrix must match every panel import declared in Dashboard, so adding
a panel without a production opening check fails. Each tab is reopened with a
round-trip to Persona. Analytics uses non-empty fixture data.
Successful JavaScript responses are matched against Rollup's actual module-to-
chunk mapping, not guessed hashed asset names. Stable sidebar/header nodes must
survive each transition.

No application server or database starts. Build and browser child environments
omit provider/database credentials. Every API read must be explicitly handled in
the browser fixture; all non-GET requests and all off-origin traffic are blocked
and fail the check. Forms are opened and dismissed, never submitted. No AI,
payment, messaging, or customer-data writes are allowed.

`generated-artifacts/dashboard-production/` (ignored by Git/deployment) contains
the compiled bundle, module/chunk evidence, JSON report and fixture screenshots.
Each run clears old results and writes a failure sentinel before building.
