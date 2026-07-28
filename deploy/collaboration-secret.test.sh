#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=collaboration-secret.sh
. "$SCRIPT_DIR/collaboration-secret.sh"

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
env_file="$temp_dir/.env"

printf 'NODE_ENV=production\n' > "$env_file"
ensureCollaborationSecret "$env_file"
generated=$(awk -F= '$1 == "COLLAB_INTERNAL_SECRET" { print $2; exit }' "$env_file")
test "${#generated}" = 64
test "$(stat -c '%a' "$env_file")" = 600

printf 'COLLAB_INTERNAL_SECRET=replace-with-a-separate-random-secret\n' > "$env_file"
if ensureCollaborationSecret "$env_file" 2>/dev/null; then
    echo "repository placeholder was accepted" >&2
    exit 1
fi

printf 'COLLAB_INTERNAL_SECRET=%s\nCOLLAB_INTERNAL_SECRET=%s\n' \
    "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$env_file"
if ensureCollaborationSecret "$env_file" 2>/dev/null; then
    echo "duplicate secret definitions were accepted" >&2
    exit 1
fi

printf 'COLLAB_INTERNAL_SECRET=%s\n' "$(openssl rand -hex 32)" > "$env_file"
before=$(cat "$env_file")
ensureCollaborationSecret "$env_file"
test "$(cat "$env_file")" = "$before"
