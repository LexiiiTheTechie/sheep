#!/bin/bash
# Portable launcher for a Sheep release.
#
# At build time __APP__ is replaced with the app directory (relative to this
# file) and __SHELL__ with the desktop shell binary. Everything else is
# handled by the shell, which mirrors the old Electron launcher behaviour:
#   --help                  -> python server.py --help
#   --nowebui / --listen /
#   --no-electron           -> engine only, no window
#   anything else           -> forwarded to server.py

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$DIR/__APP__"
SHELL_BIN="$APP/__SHELL__"

if [[ ! -x "$SHELL_BIN" ]]; then
    echo "Sheep shell not found: $SHELL_BIN" >&2
    exit 1
fi

exec "$SHELL_BIN" "$@"
