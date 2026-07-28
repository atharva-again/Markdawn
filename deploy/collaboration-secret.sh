#!/bin/bash

ensureCollaborationSecret() {
    local env_file="$1"
    local secret
    local -a secrets

    if [ ! -f "$env_file" ]; then
        echo "COLLAB_INTERNAL_SECRET validation requires an existing environment file: $env_file" >&2
        return 1
    fi

    mapfile -t secrets < <(awk -F= '$1 == "COLLAB_INTERNAL_SECRET" { print substr($0, index($0, "=") + 1) }' "$env_file")
    if [ "${#secrets[@]}" -gt 1 ]; then
        echo "COLLAB_INTERNAL_SECRET must be defined at most once in $env_file" >&2
        return 1
    fi
    secret="${secrets[0]-}"
    if [ -z "$secret" ]; then
        printf '\nCOLLAB_INTERNAL_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$env_file"
        chmod 600 "$env_file"
        return 0
    fi

    if [ "$secret" = "replace-with-a-separate-random-secret" ] || \
       [ "$secret" = "use-a-different-random-secret-here" ]; then
        echo "COLLAB_INTERNAL_SECRET still contains a repository placeholder. Replace it with: openssl rand -hex 32" >&2
        return 1
    fi

    if [ "${#secret}" -lt 32 ]; then
        echo "COLLAB_INTERNAL_SECRET must be at least 32 characters. Replace it with: openssl rand -hex 32" >&2
        return 1
    fi
}
