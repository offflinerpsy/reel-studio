# Host compatibility

| Host | Integration | Status and limits |
| --- | --- | --- |
| Codex | Embedded MCP App from `packages/studio`, using supported host appearance styles | Beta. A local preview alone does not verify an installed host integration or generation. |
| BB | Native adapter in `packages/bb`, using `@get-bb/plugin-sdk` | Beta. Host APIs and configuration differ from Codex. |
| Claude Code and other hosts | No verified compatibility claim | Support has not been verified. |

Building a package does not imply marketplace submission or acceptance. External services, authentication, permissions and available actions vary by environment. Check the host and integration configuration before use, and verify publication at its destination.

For local commands, see [getting started](getting-started.md). For the shared-source design, see [architecture](architecture.md).
