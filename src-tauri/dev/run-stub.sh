#!/usr/bin/env bash
# Run the Sheep shell against the stub engine. No TextGen dependencies needed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here/.."

export SHEEP_PYTHON="${SHEEP_PYTHON:-$(command -v python3)}"
export SHEEP_SERVER="$here/stub_server.py"
# The stub only needs a basic Python; allow the system interpreter for this
# developer workflow. The packaged app never sets this.
export SHEEP_ALLOW_EXTERNAL_PYTHON=1

exec cargo run -- "$@"
