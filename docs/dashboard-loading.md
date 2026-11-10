# Dashboard JavaScript loading

The initial dashboard keeps Persona and navigation available. Other panels use
individual dynamic imports, with a local loading indicator so the dashboard
shell does not disappear while a panel downloads.

Closed creation/profile/sharing dialogs are not mounted until first opened.
After first use they remain mounted, preserving existing close/reopen behavior.
The Chat Console loads on first tab selection, remains mounted across tab
switches, and resets when the selected agent changes. The floating chat keeps
its launcher and message badge available while deferring its renderer until the
first click.

## Measurement

Production minified assets, decimal bytes; gzip measured independently per file.
The static graph includes the shared application entry and recursively imported
dependencies, counted once. Dynamic imports are excluded: they are fetched on
demand. These are build sizes, not a browser cold-cache transfer measurement or
a claim about download time.

| Measurement | Before | After |
| --- | ---: | ---: |
| Dashboard chunk, raw | 1,186,833 B | 473,498 B |
| Dashboard chunk, gzip | 270,507 B | 107,420 B |
| Dashboard + static dependencies, raw | 2,440,505 B | 1,579,506 B |
| Dashboard + static dependencies, gzip | 667,041 B | 455,809 B |

The baseline is the existing production output before the change. Final
measurements came from `npm run build`, which also passed the TypeScript,
CSS and initial-JS checks. For a client-only build without replacing tracked
deployment output, use:

```sh
NODE_ENV=production npx vite build --manifest \
  --outDir ../generated-artifacts/dashboard-build
```

Further loading/launcher adjustments can change these exact byte counts. Inspect
the `dashboard-*.js` asset and its recursive static imports (not the Vite
dynamic-preload dependency map) when comparing future builds.

## Production build gate

`script/build.ts` runs `checkDashboardJsBudget` from a Vite `writeBundle`
hook, before staging can replace the current release. It uses Rollup's emitted
chunk metadata: identify `src/pages/dashboard.tsx` by its facade or contained module, walk
`imports` recursively (including the shared application entry), and count each
JS asset once, including cycles. It reads the actual emitted bytes and gzips
each file independently. `dynamicImports`, preload maps inside generated JS,
CSS, and unrelated chunks are not part of this JS graph.

The limits in `script/check-dashboard-js-budget.ts` are decimal bytes:

| Scope | Raw limit | Gzip limit |
| --- | ---: | ---: |
| Dashboard chunk | 520,000 B | 120,000 B |
| Dashboard + recursive static JS | 1,750,000 B | 510,000 B |

These allow roughly 10% growth over the measured split-dashboard baseline.
Both raw and gzip limits must pass. Independently of size, any emitted module
under `src/components/panels/*-panel.tsx` other than `persona-panel.tsx`
in this graph fails the build—even when Rollup inlines it into another chunk.
Missing/ambiguous dashboard identity, missing static dependencies, or missing
emitted files also fail rather than undercounting.

Keep optional panels behind dynamic imports. If intentional initial functionality
requires more code, review the import graph and update the limits with a fresh
measured baseline; do not raise limits solely to make a failing build pass.
The existing `index.html` JS budget remains separate and unchanged.
The client-only command above does not run this hook; use `npm run build` to
exercise the production gate.

Verified production output with this gate: dashboard 470,271 B raw / 106,782 B
gzip; static graph 1,584,721 B raw / 458,438 B gzip across 78 unique JS assets.

## Verification

```sh
npm run check
npx tsx --test tests/check-dashboard-js-budget.test.ts tests/check-initial-js-budget.test.ts
npm run build
npx vitest run tests/dashboard-deferred.vitest.tsx tests/dashboard-loading.vitest.tsx
```

The integration check renders the actual dashboard and initial Persona with an
isolated query cache. It verifies the delayed module loads for Chat Console,
Knowledge Base, and creation dialog, draft persistence across tab changes, and
opening/reopening the actual floating chat. Panel/dialog substitutes deliberately
avoid writes or AI calls; their internal business operations are not exercised.
The lifecycle checks also verify agent-change reset and loading feedback.
