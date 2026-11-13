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

The engine is launched directly from `../studio/dist/server.mjs`. Set
`REEL_STUDIO_ROOT` on the BB plugin process to an alternate absolute Studio
root if the packages cannot be siblings. Only configure a trusted local build:
this path selects executable code. By default the engine uses its own
`~/.local/share/reel-studio-bb` library, separate from other installations.
Set `REEL_STUDIO_HOME` explicitly to use another library. Switching to an
existing library may expose its saved projects and changes; preserve its
producer, pauses and uncertain effects. Neither selecting a directory nor
opening a workspace grants publication or producer authority.

## Handoffs

Use **Handoffs** to select an existing Codex thread in a BB project. The
adapter rechecks the selected thread, project, connected primary Mac host,
environment and project path before preparing or sending. The selected
binding lasts for the panel session; reopen the panel to choose another.
Selecting a destination does not send a message. Only an original prepared
Studio prompt with matching frozen context can be sent. The durable receipt is
written before sending, and uncertain delivery or result recording must be
reconciled against the same request; a bounded history miss never authorizes
a retry. Delivery to BB is not evidence of publication.

The shared Studio workspace retains its own production and publication
validation. This public BB package does **not** include the private line-owner
bridge, official-account overlays, or the separate BB-native production dock.
It does not transfer ownership of an existing producer or resume a schedule.
Studio features that require those private integrations need a separately
supported implementation; do not treat this adapter as installed-private-BB
feature parity. The current destination handoff route requires a primary Mac
host; other host routes are rejected rather than guessed.

`tests/` contains synthetic fixtures; tests do not launch the engine, contact
accounts, create media or publish. BB visual integration, host theme changes,
end-to-end shared-engine production and actual installation require separate
verification in an isolated host environment.
