# Testing Reel Studio

The release checks focus on observable behavior and the boundaries where failures can cost money, disclose credentials or repeat an external operation. They run locally; GitHub Actions is not required.

## Local commands

From a source checkout after `npm run setup`:

```sh
npm run build
npm test
npm test --prefix packages/studio
npm test --prefix packages/bb
npm run capabilities
npm run scan
npm run package
npm run smoke:package
```

`npm test` is the quick workspace gate. Run both package suites for a release or changes to runtime, setup, media, publishing or host integration. Refresh capabilities when tool input contracts change. After staging the intended public files, run `npm run scan -- --staged` as well.

Use the pinned lockfiles and the supported Node version. Do not upgrade the MCP SDK merely to copy an example from current upstream documentation.

## Behavioral coverage

| Boundary | Meaningful checks |
| --- | --- |
| Setup HTTP | Real loopback requests; correct and hostile Host/Origin; missing/duplicate capability; duplicate fields; oversized bodies; no credential reflection; file permissions |
| Account changes | A delayed verification cannot verify replacement credentials; disconnect/reconfiguration invalidates old OAuth selections; callback state is single-use |
| Provider requests | Mocked success, denial, timeout and redirect; credentials never reach a redirected destination; connection checks do not synthesize or publish |
| Runtime lifecycle | Original engine/model/session retained; concurrent requests; restart; cancellation; explicit resume; uncertain operations never replay automatically |
| Narration | Stable operation identity, completed WAV/timings, file hashes, bounded reads, symlink substitution, assignment and frozen job consumption |
| Research | Explicit budget, unambiguous access checks, actual cost, partial receipts and restart without replay |
| UI and bridge | User-visible navigation and states, model changes, protected setup links, disabled/error states, light/dark and narrow layouts; actual host checks where available |
| New installation | Fresh locked dependency install and build; unpacked archive without developer dependencies or private settings; real launcher and MCP catalog |
| Release | Matching versions, exact source/package scan, manifest hashes, bundled notices, real packaged gateway, remote Git tree and asset digests |

New regressions should reproduce the reported failure before the fix. Prefer a real component boundary over an assertion that repeats the implementation. Keep each fixture isolated and use temporary libraries, synthetic accounts and disposable local listeners.

## Host and UI checks

The MCP Apps guide recommends its sandboxed reference host or an actual compatible host to test the App bridge. A standalone preview checks the shared interface, but does not prove a particular host installation. The BB adapter can be tested separately with an empty paused library; preserve other installed plugins and production libraries.

Exercise controls through their visible names and wait for the expected state instead of fixed sleeps. Cover the change's error, pending and empty states as well as its successful path. Inspect screenshots when layout or theme matters. Do not use a new paid provider account, real upload or personal media as a routine UI fixture.

## Clean release smoke

The packaged gateway smoke starts with a temporary HOME, an empty paused data directory and the same Node executable used for the check. It excludes the operator's custom runtime, endpoints, credentials and `NODE_OPTIONS`. It validates the actual tool catalog and workspace through the BB gateway.

This quick smoke uses the development checkout's BB dependencies. A clean installation audit additionally extracts the archive into a new directory, runs `npm ci --prefix ./bb`, and checks the launcher and gateway without `studio/node_modules` or developer settings. Check both the minimum supported Node release and a newer supported release when runtime compatibility changes.

## External qualification

Real account sign-in, paid synthesis/inference, remote SSH production and social publication depend on the user's accounts and environment. Keep these optional manual checks separate from local protocol/state tests. Record the exact account, request and destination when checking them; a mock response, successful upload or saved record does not prove a public post. Reconcile an uncertain operation before any retry.

## References

- [MCP Apps testing guide](https://apps.extensions.modelcontextprotocol.io/api/documents/testing-mcp-apps.html)
- [Playwright testing best practices](https://playwright.dev/docs/best-practices)
- [Playwright network mocking](https://playwright.dev/docs/network)
