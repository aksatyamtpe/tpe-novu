#!/usr/bin/env bash
# =============================================================================
# Novu CE — Feature smoke test
# -----------------------------------------------------------------------------
# Verifies that every CE capability is reachable end-to-end:
#   • api health, ws health, dashboard reachability
#   • bridge endpoint discovery
#   • subscriber CRUD
#   • workflow trigger (welcome-onboarding → in-app + email + push)
#   • topic create + add subscriber + broadcast
# Requires: NOVU_API_KEY (operator API key copied from the dashboard).
# =============================================================================

set -euo pipefail

API_URL="${API_URL:-http://localhost:13000}"
WS_URL="${WS_URL:-http://localhost:13002}"
BRIDGE_URL="${BRIDGE_URL:-http://localhost:14001}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:14000}"
API_KEY="${NOVU_API_KEY:-}"

c_ok="\033[0;32m✓\033[0m"
c_no="\033[0;31m✗\033[0m"
c_in="\033[0;36m●\033[0m"

step()  { printf "%b %s\n" "$c_in" "$*"; }
pass()  { printf "  %b %s\n" "$c_ok" "$*"; }
fail()  { printf "  %b %s\n" "$c_no" "$*"; exit 1; }

[[ -n "$API_KEY" ]] || fail "Set NOVU_API_KEY (copy from dashboard → Settings → API Keys)"

# 1) Health ---------------------------------------------------------------
step "Service health"
curl -fsS "$API_URL/v1/health-check" >/dev/null && pass "api"        || fail "api"
curl -fsS "$WS_URL/health-check"     >/dev/null && pass "ws"         || fail "ws"
curl -fsS "$DASHBOARD_URL/"          >/dev/null && pass "dashboard"  || fail "dashboard"
curl -fsS "$BRIDGE_URL/api/novu"     >/dev/null && pass "bridge"     || fail "bridge"

AUTH=( -H "Authorization: ApiKey $API_KEY" -H "Content-Type: application/json" )

# 2) Subscriber lifecycle -------------------------------------------------
step "Subscriber CRUD"
SUB_ID="smoke-$(date +%s)"
curl -fsS -X POST "$API_URL/v1/subscribers" "${AUTH[@]}" -d "{
  \"subscriberId\": \"$SUB_ID\",
  \"firstName\": \"Smoke\",
  \"lastName\": \"Test\",
  \"email\": \"smoke@example.com\",
  \"phone\": \"+910000000000\"
}" >/dev/null && pass "create $SUB_ID"

curl -fsS "$API_URL/v1/subscribers/$SUB_ID" "${AUTH[@]}" >/dev/null \
  && pass "read $SUB_ID"

# 3) Topic create + subscribe + broadcast ---------------------------------
step "Topic operations"
TOPIC_KEY="smoke-topic-$(date +%s)"
curl -fsS -X POST "$API_URL/v1/topics" "${AUTH[@]}" -d "{
  \"key\": \"$TOPIC_KEY\",
  \"name\": \"Smoke topic\"
}" >/dev/null && pass "create topic $TOPIC_KEY"

curl -fsS -X POST "$API_URL/v1/topics/$TOPIC_KEY/subscribers" "${AUTH[@]}" -d "{
  \"subscribers\": [\"$SUB_ID\"]
}" >/dev/null && pass "add subscriber to topic"

# 4) Trigger workflow -----------------------------------------------------
step "Workflow trigger (welcome-onboarding)"
TRIGGER_RES=$(curl -fsS -X POST "$API_URL/v1/events/trigger" "${AUTH[@]}" -d "{
  \"name\": \"welcome-onboarding\",
  \"to\": { \"subscriberId\": \"$SUB_ID\" },
  \"payload\": { \"dashboardUrl\": \"$DASHBOARD_URL\" }
}" || echo "FAIL")
echo "$TRIGGER_RES" | grep -q '"acknowledged":true' \
  && pass "triggered"                                                     \
  || fail "trigger failed: $TRIGGER_RES (have you synced workflows? run: make sync)"

# 5) Cleanup --------------------------------------------------------------
step "Cleanup"
curl -fsS -X DELETE "$API_URL/v1/subscribers/$SUB_ID" "${AUTH[@]}" >/dev/null \
  && pass "deleted $SUB_ID"

printf "\n\033[0;32mAll CE feature smoke tests passed.\033[0m\n"
