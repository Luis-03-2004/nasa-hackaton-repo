#!/usr/bin/env bash
set -euo pipefail
WEB_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${PYTHON_BIN:-}" ]]; then
  if [[ -x "$WEB_DIR/.venv/bin/python" ]]; then
    PYTHON_BIN="$WEB_DIR/.venv/bin/python"
  else
    PYTHON_BIN="$WEB_DIR/../.venv/bin/python"
  fi
fi
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python não encontrado: $PYTHON_BIN. Configure PYTHON_BIN e instale backend/requirements.txt." >&2
  exit 1
fi
exec "$PYTHON_BIN" "$WEB_DIR/scripts/local.py" "$@"
