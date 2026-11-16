# Security

Please do not report vulnerabilities, credentials, private media or account data in public issues or pull requests.

If GitHub private vulnerability reporting is enabled for this repository, use **Security → Report a vulnerability**. Otherwise contact a maintainer privately using an available private channel. Include affected versions, a reproducible description and potential impact; share only the minimum information needed to investigate. Do not include real credentials or private media.

The project is beta software. Updates and fixes are provided on a best-effort basis; no response time or support window is promised. Verify a fix in your environment before relying on it.

## Local account and data boundaries

Use the protected setup pages opened from Settings for optional service credentials. Do not enter secrets into chats, project briefs, issues or pull requests. Setup URLs contain an ephemeral capability; do not share the complete URL or include it in screenshots.

Optional service credentials are stored on the Studio execution host in `<Studio home>/private-connections/credentials.json`. Studio creates the directory with mode `0700` and the file with mode `0600`. This is plaintext storage protected by filesystem permissions, not encryption or an OS keychain. Host administrators, processes with access to the same user, and backups may be able to read it. Protect the host and backups accordingly. Official Codex and Claude Code credentials remain in their own CLI stores.

The setup listener is restricted to loopback. Remote use goes through the configured SSH route and its loopback forwarding; do not expose setup with a public reverse proxy. Connecting a service checks only the stated account or permission information. It does not authorize a different account or prove successful publication.

Production jobs execute code with Full access and no interactive approval prompt. Install trusted code, use media you are allowed to process, and start evaluation in a separate library. Keep runtime data, private integrations, personal media and credentials outside the public source and release directory. Preserve local data and reconcile uncertain effects before applying an update; see [getting started](docs/getting-started.md#update-deliberately).
