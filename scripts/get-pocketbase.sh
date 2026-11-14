#!/bin/sh
# Fetch the pinned PocketBase binary for local tests and CI. Version must match apps/pb/Dockerfile.pocketbase.
set -e
PB_VERSION=0.39.7
DEST=${1:-.pb}
mkdir -p "$DEST"
curl -sSL -o "$DEST/pb.zip" "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
unzip -o -q "$DEST/pb.zip" -d "$DEST" && rm "$DEST/pb.zip"
echo "$DEST/pocketbase"
