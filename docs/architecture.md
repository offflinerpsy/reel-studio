# Architecture

Reel Studio has a shared source and two host surfaces:

- `packages/studio` contains the React studio, its shared service and MCP App surface. Codex embeds the MCP App and supplies host appearance styles.
- `packages/bb` provides the native BB adapter using `@get-bb/plugin-sdk`. BB and Codex expose different host capabilities; see [host compatibility](hosts.md).

Build and package from the shared source. Synchronization checks for conflicting changes at a target so local customization is not silently overwritten. It is an explicit operation, not a background watcher.

The studio organizes editable drafts and templates alongside immutable video versions, connections, and approval and publication records. A stored approval or publication record describes the recorded state; verify the actual destination before treating an external action as complete. If an external result is uncertain, reconcile the same target before trying again.

Runtime data, credentials, account bindings and personal media belong outside the public source tree. The included examples are intended for editing and reuse; check each example's provenance and any third-party terms before redistribution.
