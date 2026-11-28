#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axxlabs Limited
# Create the SHA app's own server on Hetzner Cloud (SPEC §7.4), separate from the gateway's. Needs `hcloud` with the project selected.
#   deploy/hetzner/create.sh <ssh-key-name> [server-name] [type] [location]
# Then point DNS for $DOMAIN at the printed address; Caddy gets the certificate by itself once it resolves.
set -euo pipefail
key="${1:?hcloud ssh key name}"
name="${2:-aha-app-1}"
type="${3:-cax11}"
location="${4:-nbg1}"
DOMAIN="${DOMAIN:-app.aha.axxlabs.ai}"
here="$(cd "$(dirname "$0")" && pwd)"

if ! hcloud firewall describe aha-web >/dev/null 2>&1; then
  hcloud firewall create --name aha-web --rules-file /dev/stdin <<'JSON'
[
  {"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ["0.0.0.0/0", "::/0"], "description": "ssh (keys only)"},
  {"direction": "in", "protocol": "tcp", "port": "80", "source_ips": ["0.0.0.0/0", "::/0"], "description": "http (ACME, redirect)"},
  {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": ["0.0.0.0/0", "::/0"], "description": "https"},
  {"direction": "in", "protocol": "udp", "port": "443", "source_ips": ["0.0.0.0/0", "::/0"], "description": "http/3"},
  {"direction": "in", "protocol": "icmp", "source_ips": ["0.0.0.0/0", "::/0"]}
]
JSON
fi

# The address is needed for the temporary <ip>.sslip.io name, so reserve it first.
if ! hcloud primary-ip describe "$name-v4" >/dev/null 2>&1; then
  hcloud primary-ip create --name "$name-v4" --type ipv4 --location "$location" --assignee-type server >/dev/null
fi
ip="$(hcloud primary-ip describe "$name-v4" -o format='{{.IP}}')"
sites="$DOMAIN, ${ip//./-}.sslip.io"
pub="$(hcloud ssh-key describe "$key" -o format='{{.PublicKey}}')"
userdata="$(mktemp)"
trap 'rm -f "$userdata"' EXIT
sed -e "s|@SSH_KEY@|$pub|" -e "s|@SITES@|$sites|" "$here/cloud-init.yaml" > "$userdata"

hcloud server create --name "$name" --type "$type" --image ubuntu-24.04 --location "$location" \
  --ssh-key "$key" --firewall aha-web --primary-ipv4 "$name-v4" --user-data-from-file "$userdata" \
  --label service=aha-app
echo
echo "Server $name: $ip"
echo "Temporary name: https://${ip//./-}.sslip.io (the first build takes a few minutes after boot)"
echo "DNS to add: $DOMAIN A $ip (and AAAA to the server's IPv6)"
