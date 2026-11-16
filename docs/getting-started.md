# Getting started

Reel Studio is beta software. Use a separate test workspace and test data while learning the workflow.

## Requirements

- Node.js 22 or later and npm.
- FFmpeg and `ffprobe` available on your `PATH`.
- For generation, your own authenticated official Codex CLI (supporting `codex app-server --stdio`) or Claude Code CLI on the execution host. `CODEX_BIN` or `CLAUDE_BIN` can select the executor executable.
- Python 3 for the bundled editable examples. Their rendering dependencies are described in each example.
- Credentials only for the integrations you choose. See [configuration](configuration.md).

## Run locally

Clone the repository and run:

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

The command prints a temporary library path and starts the preview server. Use the preview address it reports, then stop it with `Ctrl+C` when finished. The preview is for exploring the interface with isolated data. It does not establish that a host integration, external service, generation, or publication works in your environment.

Setup runs `npm ci` separately in each package. If either `node_modules` is a symbolic link, setup stops without modifying its target. Preserve or move the link before installing dependencies locally.

## Install a host integration

After building from the source checkout, register the local Codex marketplace from the repository root and install Reel Studio:

```sh
codex plugin marketplace add .
codex plugin add reel-studio@reel-studio-community
```

For BB, after `npm run setup` and `npm run build`, build and install its native adapter:

```sh
bb plugin build ./packages/bb
bb plugin install ./packages/bb
```

From an unpacked release directory, use the same two Codex commands. For BB in the release directory, run:

```sh
npm ci --prefix ./bb
bb plugin build ./bb
bb plugin install ./bb
```

The public adapter is not a drop-in replacement for an existing private installation. Preserve existing libraries and integrations; installing does not migrate their configuration or data. Host installation and appearance can vary with the host version. Review [host compatibility](hosts.md) before installing and [configuration](configuration.md) before enabling real work.

## Set up your first project

1. Open Studio in Codex or BB and open **Settings**. Choose the execution engine, complete its official sign-in on the execution host, then check readiness.
2. Connect only the optional services you need using the protected setup buttons. Credentials go into those local pages, not chat messages or source files. Read the [provider and cost guide](provider-setup.md) before generating narration or requesting research.
3. Start from an editable template, write a brief and add media you have the right to use. Supplied graphics and footage do not require an image-generation account. Review the chosen template's dependencies.
4. If you need Azure narration, generate and listen to the full script, then attach its completed audio to the project before starting production.
5. Review the generated film and its publication copy. Approve the exact version and destination before an explicit publish action, or export for manual publication. Verify the actual destination afterward.

Readiness checks report individual tools or connection reads. They do not prove visual quality, a complete production run, or social publication. The preview disables effectful production and publication actions; use an isolated installed library to evaluate those workflows.

## Update deliberately

Use a reviewed tagged release from [GitHub Releases](https://github.com/offflinerpsy/reel-studio/releases). Read its notes and preserve your Studio data directory, private connection files, host launch configuration and any local source edits before changing installed code. The data directory is separate from the repository and release package; do not copy it into a contribution or public archive.

Stop or reconcile active and uncertain work first. Install or rebuild the matching Studio and BB packages using the host's supported update mechanism, then reconnect and check the reported version, data path and optional connections. Test with a separate library before opening important production data. There is no background self-updater, automatic production migration or automatic adoption of a pull request. Installing the public core does not migrate an independently configured private production system.

## Build and synchronize

```sh
npm run package
npm run sync -- --help
```

Use the sync command's help for current options. Inspect its target and conflict report before applying changes. Preserve local edits and data; resolve conflicts deliberately instead of overwriting them. Packaging is not a marketplace submission or approval.

The canonical repository holds the maintained source. Sync copies the selected adapter's source, manifests, tests and skills to an explicitly named, dedicated local directory outside this repository. It excludes generated `dist`, dependencies, runtime directories and common credential files; keep all source and imported edits free of secrets. It does not watch for changes, install or reload a host. For example, review `npm run sync -- plan --target ../reel-studio-test-target --adapter studio`, then use `apply` in place of `plan` if the proposed copies are appropriate. A successful apply records a baseline in the target. `import` copies target-only edits to tracked source files only when their canonical files have not changed since that baseline; new target-only files require manual review and addition. Conflicts stop the operation; removed files require manual reconciliation. If files change during an apply, earlier copies may already have completed. Review imported changes before building or contributing them.

Run `npm run scan` before preparing a public tree, then `npm run scan -- --staged` after staging the exact intended Git tree. These scans are guards, not a substitute for reviewing the exact files and release archive. `npm run package` writes a versioned directory under `release/`, checks package versions and scans its allowlisted contents. It refuses to replace an existing output; review or move that output before making another package. After packaging, `npm run smoke:package` checks the packaged Studio catalog through the BB gateway using isolated temporary data; it does not install either host integration.

See [host compatibility](hosts.md) and [architecture](architecture.md) for the integration boundaries. For contribution checks and issue reports, see [CONTRIBUTING.md](../CONTRIBUTING.md).
