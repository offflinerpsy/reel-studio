#!/bin/sh
set -eu
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
# Remote routing is explicit. The relay validates the configuration before SSH.
if [ "${REEL_REMOTE_CONFIG+x}" = x ]; then
 exec node "$PLUGIN_DIR/server/mac-ui-relay.mjs"
fi
exec node "$PLUGIN_DIR/dist/server.mjs"
