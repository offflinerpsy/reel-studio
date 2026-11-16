# Reel Studio for BB

This package embeds the same Reel Studio workspace and engine as the sibling
`packages/studio` package in a BB navigation panel. It targets BB 0.49.x and
`@get-bb/plugin-sdk` 0.6.132. Node.js 22 or newer is required. The adapter has
not been validated against other BB or SDK versions.

In a source checkout, build Studio first using its documented installation and
build steps. Install this package's dependencies with `npm ci`, then run
`npm run typecheck` and `npm test` from this directory. Release packages omit
the tests; install their BB dependencies with `npm ci`. These checks do not install the plugin into BB
or prove that BB has loaded it. Install the package through the BB host's
supported local-plugin mechanism, retaining the sibling layout. Build and
installation must include the matching release of Studio and its generated
`capabilities.json`; incompatible versions or tool schemas are rejected.

The adapter launches the engine with `node` from the BB plugin process's `PATH`,
and checks that it is Node.js 22 or newer before connecting. If Node is installed
elsewhere, set `REEL_NODE_BIN` to its normalized absolute executable path. The
desktop app executable is never used as a substitute for Node.

By default the engine entrypoint is `../studio/dist/server.mjs`. Set
`REEL_STUDIO_ROOT` on the BB plugin process to an alternate absolute Studio
root if the packages cannot be siblings. Only configure a trusted local build:
this path selects executable code. By default the engine uses its own
`~/.local/share/reel-studio-bb` library, separate from other installations.
Set `REEL_STUDIO_HOME` explicitly to use another library. Switching to an
existing library may expose its saved projects and changes; preserve its
producer, pauses and uncertain effects. Neither selecting a directory nor
opening a workspace grants publication or producer authority.

To use the supported SSH route, set `REEL_REMOTE_CONFIG` on the BB plugin
process to a normalized absolute path to your trusted remote JSON configuration.
The adapter validates that configuration and launches the sibling Studio
`server/mac-ui-relay.mjs` instead of the local engine. Its workspace response
reports `ssh`; without that environment variable it reports `local`. An empty
or invalid explicit remote configuration fails closed, with no local fallback.
Remote release and tool schemas must still match the installed adapter.
Saved or exported settings take effect after configuring and reconnecting the
plugin process; saving them does not switch an existing connection.

## Main chat

The shared **Settings** screen selects your own Codex or Claude Code executor for
new jobs and opens protected setup pages for optional services. BB is the panel
host; choosing Claude Code does not change the host or configure another chat.
Credentials are entered outside the panel and stored on the execution host with
private filesystem permissions, not encryption or an OS keychain. See the
[provider and cost guide](https://github.com/offflinerpsy/reel-studio/blob/main/docs/provider-setup.md) for connection capabilities,
separate charges and the limits of YouTube OAuth and upload helpers.

Open **Main chat** settings and choose **Computer or server → Project → Main chat**.
The destination must be an existing Codex chat on a connected, active BB host,
with a ready workspace inside that project's source path on the same host.
Connected local and remote hosts are supported, including POSIX and Windows
workspace paths. The current context is suggested when eligible; **Use this
chat** explicitly selects it for the panel session. **Change main chat** lets
you choose a different destination. Neither action creates a chat or sends a
task.

The adapter rechecks the selected chat, project, host, environment and source
path, including the exact destination fingerprint at binding and before each
handoff. Only an original prepared Studio prompt with matching frozen context
can be sent. Browser access, signed-in accounts and approved media must already
be available in the destination chat's own environment; selecting a remote
chat transfers none of them. The durable receipt is
written before sending, and uncertain delivery or result recording must be
reconciled against the same request; a bounded history miss never authorizes
a retry. Delivery to BB is not evidence of publication.

The shared Studio workspace retains its own production and publication
validation. This public BB package does **not** include the private line-owner
bridge, official-account overlays, or the separate BB-native production dock.
It does not transfer ownership of an existing producer or resume a schedule.
Studio features that require those private integrations need a separately
supported implementation; do not treat this adapter as installed-private-BB
feature parity. Selecting a connected remote chat does not prove that its
browser environment or media access is ready to complete a particular request.

`tests/` contains synthetic fixtures; tests do not launch the engine, contact
accounts, create media or publish. BB visual integration, host theme changes,
end-to-end shared-engine production and actual installation require separate
verification in an isolated host environment.
