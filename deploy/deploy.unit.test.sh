#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_script="$SCRIPT_DIR/deploy.sh"

pull_line=$(grep -n '^git pull origin master$' "$deploy_script" | cut -d: -f1)
source_line=$(grep -n '^\. .*collaboration-secret\.sh"$' "$deploy_script" | cut -d: -f1)

test -n "$pull_line"
test -n "$source_line"
test "$source_line" -gt "$pull_line"
