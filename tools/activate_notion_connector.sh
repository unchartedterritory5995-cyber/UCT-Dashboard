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

# ⛔⛔ THE TWO WRITES ARE NOT ATOMIC AND THE GAP IS AN INTERACTIVE PROMPT.
# `NOTION_CLIENT_ID` is written, then the operator is asked for the secret — which
# is the likeliest Ctrl-C in the whole script, because it is where somebody goes
# back to Notion to find the value. Until 2026-09-15 an abort there left
# NOTION_CLIENT_ID set on the SERVICE with no secret beside it: invisible (the
# connector stays inert either way, so nothing reports it), durable, and waiting
# to be paired with whatever secret the next attempt supplies.
#
# The trap removes it on any non-clean exit. It removes ONLY the variable this run
# wrote, and only when the run did not get as far as the secret.
# ⚠️ `railway variable delete` takes no `--skip-deploys`, so the removal may
# trigger a deploy. That is the right trade: nothing has deployed yet at this
# point (both writes stage with --skip-deploys), so the delete returns the service
# to the configuration it had before this script ran.
ID_STAGED=0
SECRET_STAGED=0

cleanup() {
  rc=$?
  trap - EXIT INT TERM
  if [ "$rc" -ne 0 ] && [ "$ID_STAGED" -eq 1 ] && [ "$SECRET_STAGED" -eq 0 ]; then
    echo >&2
    echo "!! aborted (exit $rc) with NOTION_CLIENT_ID staged and NO secret beside it." >&2
    echo "   Removing it, so the service cannot be left half-configured." >&2
    if timeout 60 railway variable delete NOTION_CLIENT_ID \
         --service "$SERVICE" --environment "$ENVIRONMENT" </dev/null >/dev/null 2>&1; then
      echo "   NOTION_CLIENT_ID removed." >&2
    else
      echo "!! COULD NOT remove it. NOTION_CLIENT_ID IS STILL SET. Run:" >&2
      echo "     railway variable delete NOTION_CLIENT_ID --service $SERVICE --environment $ENVIRONMENT" >&2
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT INT TERM

# -s = silent (no echo). The value is never assigned to a variable that gets
# printed, and --skip-deploys keeps BOTH writes in one deploy rather than
# restarting the pod twice mid-configuration.
read -rsp "Notion OAuth client ID:     " NOTION_ID; echo
[ -n "$NOTION_ID" ] || { echo "empty, aborting"; exit 1; }
printf '%s' "$NOTION_ID" | railway variable set NOTION_CLIENT_ID --stdin \
  --service "$SERVICE" --environment "$ENVIRONMENT" --skip-deploys >/dev/null
unset NOTION_ID
ID_STAGED=1
echo "  NOTION_CLIENT_ID staged."

read -rsp "Notion OAuth client secret: " NOTION_SECRET; echo
[ -n "$NOTION_SECRET" ] || { echo "empty, aborting"; exit 1; }
printf '%s' "$NOTION_SECRET" | railway variable set NOTION_CLIENT_SECRET --stdin \
  --service "$SERVICE" --environment "$ENVIRONMENT" --skip-deploys >/dev/null
unset NOTION_SECRET
SECRET_STAGED=1
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
