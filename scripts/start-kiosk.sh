#!/usr/bin/env bash
# Opens the local page in Chromium, full screen. Runs on the machine itself (not in the container) because it needs the
# graphical session. Waits for the agent to answer, then restarts nothing by itself: systemd restarts this script.
set -euo pipefail

KIOSK_URL="${KIOSK_URL:-http://localhost:3000}"
KIOSK_WAIT_TIMEOUT_SECONDS="${KIOSK_WAIT_TIMEOUT_SECONDS:-120}"
KIOSK_PROFILE_DIR="${KIOSK_PROFILE_DIR:-$HOME/.cache/smartcampus-kiosk}"

find_chromium() {
  if [[ -n "${CHROMIUM_BIN:-}" ]]; then
    printf '%s\n' "$CHROMIUM_BIN"
    return 0
  fi
  for candidate in chromium-browser chromium google-chrome-stable google-chrome; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

wait_for_agent() {
  command -v curl >/dev/null 2>&1 || { sleep "${KIOSK_START_DELAY_SECONDS:-10}"; return 0; }
  local deadline=$((SECONDS + KIOSK_WAIT_TIMEOUT_SECONDS))
  until curl --fail --silent --max-time 2 "$KIOSK_URL/health" >/dev/null; do
    if ((SECONDS >= deadline)); then
      printf 'Timed out waiting for %s. Starting Chromium anyway.\n' "$KIOSK_URL" >&2
      return 0
    fi
    sleep 2
  done
}

# A wall screen must not blank or sleep.
keep_screen_on() {
  if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank >/dev/null 2>&1 || true
  fi
}

chromium_bin="$(find_chromium)" || { printf 'Chromium was not found. Install chromium or chromium-browser.\n' >&2; exit 1; }

mkdir -p "$KIOSK_PROFILE_DIR"
wait_for_agent
keep_screen_on

# --autoplay-policy: the alarm and the sounds must play without anyone touching the screen.
exec "$chromium_bin" \
  --kiosk "$KIOSK_URL" \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --password-store=basic \
  --user-data-dir="$KIOSK_PROFILE_DIR"
