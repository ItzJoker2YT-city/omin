#!/bin/sh
# Auto-detect the public domain so OmniRoute's CSRF / "not local" checks pass.
# Priority: PUBLIC_URL (custom domain) > RENDER_EXTERNAL_URL (Render) > FLY_APP_NAME.fly.dev (Fly.io).
URL="${PUBLIC_URL:-$RENDER_EXTERNAL_URL}"
[ -z "$URL" ] && [ -n "$FLY_APP_NAME" ] && URL="https://${FLY_APP_NAME}.fly.dev"
URL="${URL%/}"            # strip trailing slash
URL="${URL%/v1}"          # strip accidental /v1

if [ -n "$URL" ]; then
  export OMNIROUTE_PUBLIC_BASE_URL="${OMNIROUTE_PUBLIC_BASE_URL:-$URL}"
  export NEXT_PUBLIC_BASE_URL="${NEXT_PUBLIC_BASE_URL:-$URL}"
  case "$URL" in https://*) export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-true}";; esac
  echo "[render-start] Public URL: $OMNIROUTE_PUBLIC_BASE_URL"
else
  echo "[render-start] WARNING: no PUBLIC_URL or RENDER_EXTERNAL_URL found"
fi

# Listen on all interfaces so Render can reach the app
export HOST="${HOST:-0.0.0.0}"
export OMNIROUTE_SERVER_HOST="${OMNIROUTE_SERVER_HOST:-0.0.0.0}"

# Restore backup, start OmniRoute, back up on schedule + before shutdown/deploy
exec node --max-old-space-size=48 /app/backup-runner.mjs "$@"
