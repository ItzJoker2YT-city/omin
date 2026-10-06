#!/bin/sh
# Fly.io: volume at /data is owned by root — give it to the node user, then drop privileges.
mkdir -p /data && chown -R node:node /data 2>/dev/null || true
if command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid=node --regid=node --init-groups /app/render-start.sh "$@"
fi
exec /app/render-start.sh "$@"
