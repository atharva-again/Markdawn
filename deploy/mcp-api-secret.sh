#!/bin/bash

MCP_API_DEVELOPMENT_SECRET='development-only-mcp-api-secret-0123456789abcdef'

ensureMcpApiInternalSecret() {
    local env_file="$1"
    local -a secrets
    local secret
    local normalized_secret

    if [ ! -f "$env_file" ]; then
        echo "MCP API internal secret validation requires an existing environment file: $env_file" >&2
        return 1
    fi

    mapfile -t secrets < <(awk -F= '$1 == "MCP_API_INTERNAL_SECRET" { print substr($0, index($0, "=") + 1) }' "$env_file")
    if [ "${#secrets[@]}" -gt 1 ]; then
        echo "MCP_API_INTERNAL_SECRET must be defined at most once in $env_file" >&2
        return 1
    fi

    secret="${secrets[0]-}"
    if [ -z "$secret" ]; then
        printf '\nMCP_API_INTERNAL_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$env_file"
        chmod 600 "$env_file"
        return 0
    fi

    normalized_secret="${secret#\"}"
    normalized_secret="${normalized_secret%\"}"
    normalized_secret="${normalized_secret#\'}"
    normalized_secret="${normalized_secret%\'}"

    if [ "${#normalized_secret}" -lt 32 ]; then
        echo "MCP_API_INTERNAL_SECRET must be at least 32 characters. Replace it with: openssl rand -hex 32" >&2
        return 1
    fi

    if [ "$normalized_secret" = "$MCP_API_DEVELOPMENT_SECRET" ]; then
        echo "MCP_API_INTERNAL_SECRET must not use the development value for deployment" >&2
        return 1
    fi
}
