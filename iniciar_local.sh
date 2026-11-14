#!/usr/bin/env bash
set -euo pipefail
WEB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$WEB_DIR/../.venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python não encontrado: $PYTHON_BIN. Configure PYTHON_BIN com Python 3.12.2 e instale backend/requirements.txt." >&2
  exit 1
fi
exec "$PYTHON_BIN" "$WEB_DIR/scripts/local.py" "$@"
