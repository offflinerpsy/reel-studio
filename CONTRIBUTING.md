# Contributing

Thank you for helping improve Reel Studio. Please read the [Code of Conduct](CODE_OF_CONDUCT.md).

For a bug, open an issue with the affected host, versions, steps to reproduce, expected and actual behavior, and a sanitized error or screenshot if useful. For a larger change, describe the problem and proposed approach in an issue before investing in implementation. Use the issue templates where available.

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

Keep credentials, private account details, production bindings and personal media out of issues, commits and test fixtures. Use synthetic data and editable examples with clear provenance and redistribution rights. Do not run paid generation or publish content as a contribution check. Preserve third-party notices and licenses.

Open a pull request describing the problem, the change and any limitations. A maintainer may request changes before merging. For a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
