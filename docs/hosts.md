# Host compatibility

| Host | Integration | Status and limits |
| --- | --- | --- |
| Codex | Embedded MCP App from `packages/studio`, using supported host appearance styles | Beta. Requires a compatible plugin/MCP App host and Codex CLI. A local preview alone does not verify installation, host rendering or generation. |
| BB | Native adapter in `packages/bb`, targeting BB 0.49.x and `@get-bb/plugin-sdk` 0.6.132 | Beta. Other versions have not been validated. Main chat selects an eligible existing Codex chat on a connected, active local or remote computer; the destination fingerprint is rechecked before handoff. |
| Claude Code | Optional execution CLI, not a Studio panel host | Uses your own subscription through the unmodified official CLI. This does not claim a Claude-hosted MCP App or native panel. |
| Other hosts | No verified compatibility claim | Support has not been verified. |

The BB adapter embeds the shared Studio engine. It does not include private line-owner bridges, official-account overlays or a separate BB-native production dock. Features requiring those private components are not provided by the public adapter.

Selecting a BB main chat does not send a task or transfer browser sessions, account authentication or media. Codex uses the chat in which Studio was opened. See [Main chat configuration](configuration.md#main-chat) for both flows.

Local production uses the selected Codex or Claude Code executor on the Studio server. Both panel surfaces share the setup interface; executor choice does not change the panel host. The optional SSH route is a separately configured topology, not proof of general Linux, Windows or remote-host compatibility. There is no automatic remote discovery or fallback. See [configuration](configuration.md) and [provider setup](provider-setup.md).

Building a package does not imply marketplace submission or acceptance. External services, authentication, permissions and available actions vary by environment. Verify the exact installed host surface and any public post at its destination.

For 0.4.0, the installed BB 0.49 adapter, shared Settings panel and protected setup link were checked with an isolated, paused, empty library. The shared preview was also checked in light and dark themes and at 390px width, including credential-form save/remove using synthetic data. Final 0.4.0 Codex installation pixels, real remote production, paid provider generation and public posting remain unverified. The existing private production installation was preserved.

For local commands, see [getting started](getting-started.md). For the shared-source design, see [architecture](architecture.md).
