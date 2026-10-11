#!/usr/bin/env bash
# Copies the app's settings from .env into EAS, for cloud builds
# (step-tracker-builds.txt, Part A). .env stays on this Mac and is never
# uploaded; EAS keeps its own copy of these values, per environment.
#
# Only the names below are ever sent. They are all values the app carries
# inside it anyway (anyone can read them from a build), so they're stored
# as plain text. Secrets (SUPABASE_DB_PASSWORD, any service role key, the
# Apple .p8 key, a Sentry auth token) are NOT in the list and never sent.
#
# Usage, after `eas login` and `eas init`:
#   bash scripts/eas-env.sh                 # all three environments
#   bash scripts/eas-env.sh production      # just one
# Values are never printed. Empty ones are skipped.
set -euo pipefail
cd "$(dirname "$0")/.."

ALLOWED=(
  EXPO_PUBLIC_SUPABASE_URL
  EXPO_PUBLIC_SUPABASE_KEY
  EXPO_PUBLIC_PRIVACY_URL
  EXPO_PUBLIC_SUPPORT_EMAIL
  EXPO_PUBLIC_APPLE_SIGN_IN
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  EXPO_PUBLIC_PUSH_NOTIFICATIONS
  EXPO_PUBLIC_EAS_PROJECT_ID
  APPLE_TEAM_ID
)

if [ ! -f .env ]; then
  echo "No .env here. Copy .env.example to .env and fill it in first."
  exit 1
fi

if [ $# -gt 0 ]; then ENVS=("$@"); else ENVS=(development preview production); fi
env_flags=()
for e in "${ENVS[@]}"; do env_flags+=(--environment "$e"); done

# The value of one name from .env (last one wins), without quotes
value_of() {
  local line
  line=$(grep -E "^[[:space:]]*$1=" .env | tail -n 1 || true)
  line=${line#*=}
  line=${line%$'\r'}
  line=${line#\"}; line=${line%\"}
  line=${line#\'}; line=${line%\'}
  printf '%s' "$line"
}

sent=0
for name in "${ALLOWED[@]}"; do
  value=$(value_of "$name")
  if [ -z "$value" ]; then
    echo "skip  $name (empty in .env)"
    continue
  fi
  npx -y eas-cli@latest env:set --name "$name" --value "$value" "${env_flags[@]}" \
    --visibility plaintext --scope project --non-interactive > /dev/null
  echo "set   $name -> ${ENVS[*]}"
  sent=$((sent + 1))
done
echo "$sent settings sent to EAS. Check them with: npx eas-cli@latest env:list"
