#!/usr/bin/env bash
# Activate the Notion note connector on Railway.
#
# WHY THIS SCRIPT EXISTS: the two Notion values are secrets. They must never
# appear in a chat message, a shell history entry, a command line (visible in
# `ps`), a commit, or an agent's context. `railway variable set --stdin` reads
# a value from stdin, so this script prompts for each with echo OFF and pipes
# it straight through. Nothing is stored on disk and nothing is printed back.
#
# WHAT YOU NEED FIRST (the only human-only step in the whole activation):
#   1. Sign in at https://www.notion.so/profile/integrations
#   2. New integration -> type: PUBLIC (OAuth).
#      ⛔ NOT "Internal" / "Access token". An internal integration issues a
#         single token and no client_id/secret, and `note_connectors/oauth.py`
#         has nothing to call with it — this is the trap that has stalled this
#         activation before.
#   3. Capabilities: grant READ CONTENT. Without it every call 403s on the
#      first sync tick, which looks like a broken connector rather than a
#      missing checkbox.
#   4. Redirect URI — paste EXACTLY, no trailing slash:
#         https://uctintelligence.com/api/j2/notes/connectors/notion/callback
#      (derived from DASHBOARD_URL + the path in oauth.py::_redirect_uri; that
#      route is already deployed and answers 400, not 404.)
#   5. Copy the OAuth client ID and client secret, then run this script.
#
# Then run:  bash tools/activate_notion_connector.sh
set -euo pipefail

SERVICE="${SERVICE:-web}"
ENVIRONMENT="${ENVIRONMENT:-production}"

command -v railway >/dev/null || { echo "railway CLI not found"; exit 1; }
railway status >/dev/null 2>&1 || {
  echo "This directory is not linked to a Railway project. Run:"
  echo "  railway link --project luminous-recreation --service web --environment production"
  exit 1
}

echo "Target: service=$SERVICE environment=$ENVIRONMENT"
echo

# -s = silent (no echo). The value is never assigned to a variable that gets
# printed, and --skip-deploys keeps BOTH writes in one deploy rather than
# restarting the pod twice mid-configuration.
read -rsp "Notion OAuth client ID:     " NOTION_ID; echo
[ -n "$NOTION_ID" ] || { echo "empty, aborting"; exit 1; }
printf '%s' "$NOTION_ID" | railway variable set NOTION_CLIENT_ID --stdin \
  --service "$SERVICE" --environment "$ENVIRONMENT" --skip-deploys >/dev/null
unset NOTION_ID
echo "  NOTION_CLIENT_ID staged."

read -rsp "Notion OAuth client secret: " NOTION_SECRET; echo
[ -n "$NOTION_SECRET" ] || { echo "empty, aborting"; exit 1; }
printf '%s' "$NOTION_SECRET" | railway variable set NOTION_CLIENT_SECRET --stdin \
  --service "$SERVICE" --environment "$ENVIRONMENT" --skip-deploys >/dev/null
unset NOTION_SECRET
echo "  NOTION_CLIENT_SECRET staged."

echo
echo "Both values are STAGED. ⛔ Staging is not running: a Railway variable set"
echo "does not restart the process, so the pod is still serving without them"
echo "until it redeploys. Trigger that now:"
echo
echo "    railway redeploy --service $SERVICE --yes"
echo
echo "Then verify BY THE ARTIFACT, not by the variable list — /api/health's"
echo "uptime_seconds must RESET, and the Notion tile must appear in the"
echo "Notebook's Import dialog (it is hidden today precisely because"
echo "configured() is false without these two values)."
