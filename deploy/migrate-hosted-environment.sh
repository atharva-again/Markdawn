#!/bin/bash

migrateHostedEnvironment() {
    local env_file="$1"
    local variable
    local changed=false

    if [ ! -f "$env_file" ]; then
        echo "[ERROR] Environment file not found: $env_file" >&2
        return 1
    fi

    for variable in FRONTEND_URL CORS_ORIGINS VITE_API_URL; do
        if grep -Eq "^${variable}=https://markdawn\\.space/?$" "$env_file"; then
            sed -i -E "s|^${variable}=https://markdawn\\.space/?$|${variable}=https://app.markdawn.space|" "$env_file"
            changed=true
        fi
    done

    if grep -q '^VITE_APP_URL=' "$env_file"; then
        sed -i '/^VITE_APP_URL=/d' "$env_file"
        changed=true
    fi

    if [ "$changed" = true ]; then
        echo "[MIGRATION] Updated environment URL settings in $env_file."
    fi
}
