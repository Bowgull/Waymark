#!/usr/bin/env bash
# Setup and cleanup between Maestro flows, against the runner's test Worker
# (scratch local D1, test key; never production). Usage:
#   .maestro/sim-api.sh good-morning | sore-back | add <type> [label] | finish-open
set -euo pipefail
API="${E2E_API:-http://127.0.0.1:8787}"
KEY="${E2E_API_KEY:?E2E_API_KEY not set}"
TODAY="$(date +%F)"
call() { curl -sS --fail-with-body -X "$1" "$API$2" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' ${3:+-d "$3"}; echo; }

case "${1:-}" in
  good-morning)
    call POST /api/daily-logs "{\"date\":\"$TODAY\",\"sleepHours\":8,\"sleepQuality\":4,\"energy\":4,\"soreness\":2,\"stress\":2,\"mood\":4,\"backToday\":4,\"alcoholScale\":0,\"herbScale\":0}" ;;
  sore-back)
    call POST /api/daily-logs "{\"date\":\"$TODAY\",\"backToday\":2}" ;;
  add)
    label="${3:-}"
    call POST /api/sessions/insert-ad-hoc "{\"type\":\"$2\",\"timeSlot\":\"pm\",\"date\":\"$TODAY\",\"today\":\"$TODAY\"${label:+,\"label\":\"$label\"}}" ;;
  finish-open)
    # Anything left in progress: completed, so the next launch doesn't resume into it.
    for id in $(call GET "/api/sessions/today?date=$TODAY" | jq -r '.[] | select(.status=="in_progress") | .id'); do
      echo "completing $id"
      call PATCH "/api/sessions/$id" "{\"status\":\"completed\",\"completedAt\":$(date +%s)}"
    done ;;
  *) echo "unknown command: ${1:-}"; exit 2 ;;
esac
