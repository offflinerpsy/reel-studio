# Contributing

Thank you for helping improve Reel Studio. Please read the [Code of Conduct](CODE_OF_CONDUCT.md).

Write public documentation, issue and pull request text, and interface labels in English. Video content and account metadata can use the language of their brief. Keep integration claims specific: a local check, saved connection or prepared browser handoff does not establish that a service is authenticated or that a video was published.

For a bug, open an issue with the affected host, versions, steps to reproduce, expected and actual behavior, and a sanitized error or screenshot if useful. For a larger change, describe the problem and proposed approach in an issue before investing in implementation. Use the issue templates where available.

Issues are voluntary requests, not a work order or a promise of a fix. Anyone may fork the repository and submit a pull request. Maintainers choose which changes to review, merge and release; support is best effort with no SLA. Please keep a proposed change useful for a public installation rather than depending on a private account or production setup.

## Development

Follow [getting started](docs/getting-started.md) for requirements and setup. Make focused changes in a branch, then run the checks relevant to your change:

```sh
npm run build
npm test
```

Checks run locally; GitHub Actions and a hosted CI service are not required. For a release, also run the complete package test suites and verify the packaged application:

```sh
npm test --prefix packages/studio
npm test --prefix packages/bb
npm run scan -- --staged
npm run package
npm run smoke:package
```

For package or synchronization changes, also run `npm run package` and inspect `npm run sync -- --help`. Describe the checks you ran and their results in your pull request. For interface changes, include screenshots or a short description of what you inspected in the affected host and theme.

When changing MCP tools or their input schemas, run `npm run capabilities` before building to refresh the BB contract from the actual local server. This uses an isolated library and does not sign in, generate media or call a provider.

See the [testing guide](docs/testing.md) for the release matrix, clean-install checks and optional external qualification. A bug report with a minimal reproduction or a pull request with a focused regression is especially useful.

Keep credentials, private account details, production bindings and personal media out of issues, commits and test fixtures. Use synthetic data and editable examples with clear provenance and redistribution rights. Do not run paid generation or publish content as a contribution check. Preserve third-party notices and licenses.

Open a pull request describing the problem, the change and any limitations. A maintainer may request changes before merging. For a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Merged improvements reach users through reviewed tagged releases. Users explicitly update their installed code and preserve their local data and configuration; a merged pull request does not update anyone's installation or private production system. See [the update steps](docs/getting-started.md#update-deliberately).

If the project is useful to you, a [GitHub star](https://github.com/offflinerpsy/reel-studio) helps others find it.
