#!/usr/bin/env bash
# Rebuilds @smartcampus/protocol and @smartcampus/handshake in the CentralServer checkout and vendors them here as
# tarballs. The server's schemas are the contract: this repo never edits them, it only consumes a pinned copy.
#   scripts/sync-protocol.sh [path to SmartCampus-CentralServer]   (default: ../SmartCampus-CentralServer)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
server="${1:-$here/../SmartCampus-CentralServer}"
[[ -d "$server/packages/protocol" ]] || { echo "CentralServer checkout not found at $server" >&2; exit 1; }

# Built from a clean state so a stale dist can never end up in the tarball.
(cd "$server" && pnpm --filter @smartcampus/protocol --filter @smartcampus/handshake build)
rm -f "$here"/vendor/smartcampus-*.tgz
for pkg in protocol handshake; do
  (cd "$server/packages/$pkg" && pnpm pack --pack-destination "$here/vendor" >/dev/null)
done

# Where the vendored copy came from, so a drift is visible in review.
{
  echo "Vendored from SmartCampus-CentralServer"
  (cd "$server" && echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)$(git diff --quiet 2>/dev/null || echo ' (with uncommitted changes)')")
  (cd "$here/vendor" && sha256sum smartcampus-*.tgz)
} > "$here/vendor/SOURCE.txt"

(cd "$here" && pnpm install --no-frozen-lockfile)
echo "Vendored protocol and handshake from $server"
cat "$here/vendor/SOURCE.txt"
