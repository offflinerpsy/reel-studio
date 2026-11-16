# Architecture

Reel Studio has a shared source and two host surfaces:

- `packages/studio` contains the React studio, its shared service and MCP App surface. Codex embeds the MCP App and supplies host appearance styles.
- `packages/bb` provides the native BB adapter using `@get-bb/plugin-sdk`. BB and Codex expose different host capabilities; see [host compatibility](hosts.md).

Build and package from the shared source. Synchronization checks for conflicting changes at a target so local customization is not silently overwritten. It is an explicit operation, not a background watcher.

The studio organizes editable drafts and templates alongside immutable video versions, connections, and approval and publication records. A stored approval or publication record describes the recorded state; verify the actual destination before treating an external action as complete. If an external result is uncertain, reconcile the same target before trying again.

Runtime data, credentials, account bindings and personal media belong outside the public source tree. The included examples are intended for editing and reuse; check each example's provenance and any third-party terms before redistribution.

The selected executor starts a local official Codex `app-server` or Claude Code CLI process on the Studio server. Engine selection applies to new jobs; persisted jobs route to their original executor and native session. There is no automatic API/provider fallback. The renderer builds editable HTML/GSAP/Three.js compositions with HyperFrames and FFmpeg, without a HeyGen dependency.

Protected loopback setup pages keep credential form values outside MCP arguments and React state. They store optional service credentials in the server's private data folder using restricted filesystem permissions. Official executor authentication remains owned by each CLI. Azure narration and direct DataForSEO research are separate optional services, so changing executors does not implicitly buy another model or transfer an account.

An explicit remote configuration can select the SSH relay and compute router. That route requires separately provisioned hosts and paths; it does not migrate existing jobs or credentials. The relay forwards protected setup pages over an owned loopback SSH tunnel. See [configuration](configuration.md) for runtime and integration boundaries.
