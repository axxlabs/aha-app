#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axxlabs Limited
# Build and publish the app from the public repo's main branch (SPEC §7.4). Run by a systemd timer every
# 30 seconds; does nothing when main hasn't moved. `--force` rebuilds the current commit.
# The build runs in a throwaway container as this user; a release only goes live if the tests pass.
set -euo pipefail
SRC="${AHA_APP_SRC:-/opt/aha-app/src}"
SITE="${AHA_APP_SITE:-/srv/aha-app}"
NODE_IMAGE="docker.io/library/node@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee"  # node:22-slim, pinned

cd "$SRC"
git fetch -q origin main
commit="$(git rev-parse origin/main)"
short="${commit:0:12}"
current="$(basename "$(readlink "$SITE/current" 2>/dev/null || echo none)")"
if [[ $short == "$current" && ${1:-} != --force ]]; then exit 0; fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git archive "$commit" | tar -x -C "$work"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e AHA_BUILD="${commit:0:7}" \
  -v "$work:/app" -w /app "$NODE_IMAGE" sh -c "npm ci --no-audit --no-fund && npm test && npm run build"

release="$SITE/releases/$short"
rm -rf "$release.tmp"
cp -r "$work/dist" "$release.tmp"
{
  echo "aha-app $commit"
  echo "built $(date -u +%Y-%m-%dT%H:%M:%SZ) from https://github.com/axxlabs/aha-app"
  (cd "$release.tmp" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
} > "$release.tmp/release.txt"
rm -rf "$release"
mv "$release.tmp" "$release"
ln -sfn "releases/$short" "$SITE/current.tmp"
mv -T "$SITE/current.tmp" "$SITE/current"
echo "published $short"
# keep the last five releases
ls -1t "$SITE/releases" | tail -n +6 | while read -r old; do rm -rf "${SITE:?}/releases/$old"; done
