#!/usr/bin/env bash
# =============================================================================
# tpe-cli — terminal tool for the TPE Novu staging deployment.
# -----------------------------------------------------------------------------
# Stage stopgap until the admin UI lands. Lets engineers + Operations:
#   - List the registered workflows
#   - Trigger a workflow against a subscriber
#   - List recent triggers (activity feed) + filter by transactionId
#   - List/CRUD subscribers
#   - Generate a UUID (we hit the triggerInstanceId UUID validation rule
#     enough to make this worth a built-in helper)
#
# Usage:
#   tpe-cli list-workflows
#   tpe-cli list-subscribers [LIMIT]
#   tpe-cli show-subscriber SUBSCRIBER_ID
#   tpe-cli trigger WORKFLOW_NAME SUBSCRIBER_ID '<json-payload>'
#   tpe-cli history [LIMIT]
#   tpe-cli show-trigger TRANSACTION_ID
#   tpe-cli uuid
#   tpe-cli health
#
# Environment (override defaults via env or `.tpe-cli.env`):
#   TPE_API           — http://103.138.96.180/api  (default)
#   TPE_API_KEY       — Development env API Secret Key (REQUIRED)
#
# Examples:
#   export TPE_API_KEY=48b05a9d8ec84976aefa2d6faed52078
#   tpe-cli list-workflows
#   tpe-cli trigger ph-09-investor-matched test-icpaas-1 \
#     "{\"ph_id\":\"x\",\"policyNumber\":\"P-1\",\"matchId\":\"m-1\",\"triggerInstanceId\":\"$(tpe-cli uuid)\"}"
# =============================================================================
set -euo pipefail

API="${TPE_API:-http://103.138.96.180/api}"
KEY="${TPE_API_KEY:-}"

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \?//'
  exit 1
}

require_key() {
  if [[ -z "$KEY" ]]; then
    echo "ERROR: TPE_API_KEY not set. Export from Novu dashboard → Settings → API Keys." >&2
    exit 2
  fi
}

case "${1:-help}" in

  list-workflows)
    require_key
    curl -fsS "$API/v1/workflows" -H "Authorization: ApiKey $KEY" \
      | python3 -c "
import sys, json
d = json.load(sys.stdin); items = d.get('data', [])
print(f'Workflows registered: {len(items)}')
print()
for w in sorted(items, key=lambda x: x.get('name','')):
    tags = ','.join(w.get('tags', [])[:3])
    print(f'  {w[\"name\"]:42s}  type={w.get(\"type\",\"?\"):8s}  active={str(w.get(\"active\",\"?\")):5s}  tags=[{tags}]')
"
    ;;

  list-subscribers)
    require_key
    LIMIT="${2:-10}"
    curl -fsS "$API/v1/subscribers?limit=$LIMIT" -H "Authorization: ApiKey $KEY" \
      | python3 -c "
import sys, json
d = json.load(sys.stdin); items = d.get('data', [])
print(f'Subscribers (showing {len(items)}):')
for s in items:
    name = ' '.join(filter(None,[s.get('firstName'), s.get('lastName')])) or '(no name)'
    print(f'  {s[\"subscriberId\"]:30s}  {name:30s}  email={s.get(\"email\",\"-\")}  phone={s.get(\"phone\",\"-\")}')
"
    ;;

  show-subscriber)
    require_key
    SUB="${2:?subscriberId required}"
    curl -fsS "$API/v1/subscribers/$SUB" -H "Authorization: ApiKey $KEY" \
      | python3 -m json.tool
    ;;

  trigger)
    require_key
    NAME="${2:?workflow name required}"
    SUB="${3:?subscriberId required}"
    PAYLOAD="${4:-{}}"
    REQ=$(python3 -c "
import json, sys
print(json.dumps({'name': '$NAME', 'to': {'subscriberId': '$SUB'}, 'payload': json.loads('''$PAYLOAD''')}))
")
    RESULT=$(curl -fsS -X POST "$API/v1/events/trigger" \
      -H "Authorization: ApiKey $KEY" -H "Content-Type: application/json" \
      -d "$REQ")
    echo "$RESULT" | python3 -m json.tool
    TX=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('transactionId',''))")
    if [[ -n "$TX" ]]; then
      echo ""
      echo "→ tail with: tpe-cli show-trigger $TX"
    fi
    ;;

  history)
    require_key
    LIMIT="${2:-10}"
    curl -fsS "$API/v1/notifications?limit=$LIMIT" -H "Authorization: ApiKey $KEY" \
      | python3 -c "
import sys, json
d = json.load(sys.stdin); items = d.get('data', [])
print(f'Recent triggers ({len(items)}):')
print()
for n in items:
    wf = n.get('template',{}).get('name','?')
    sub = n.get('subscriber',{}).get('subscriberId','?')
    ch = ','.join(n.get('channels', []) or [])
    ts = n.get('createdAt','?')[:19]
    tx = n.get('transactionId','')
    print(f'  {ts}  {wf:42s}  → {sub:24s}  [{ch}]  tx={tx[:8]}')
"
    ;;

  show-trigger)
    require_key
    TX="${2:?transactionId required}"
    curl -fsS "$API/v1/notifications?transactionId=$TX" -H "Authorization: ApiKey $KEY" \
      | python3 -c "
import sys, json
d = json.load(sys.stdin); items = d.get('data', [])
for n in items:
    print(f'workflow: {n.get(\"template\",{}).get(\"name\",\"?\")}')
    print(f'subscriber: {n.get(\"subscriber\",{}).get(\"subscriberId\",\"?\")}')
    print(f'transactionId: {n.get(\"transactionId\",\"?\")}')
    print()
    print('Steps:')
    for j in n.get('jobs', []):
        step_name = j.get('step',{}).get('name') or j.get('step',{}).get('uuid','?')
        print(f'  {step_name:30s}  type={j.get(\"type\",\"?\"):8s}  status={j.get(\"status\",\"?\")}')
        for ed in j.get('executionDetails',[])[-2:]:
            raw = (ed.get('raw') or '')[:120].replace(chr(10), ' ')
            print(f'      [{ed.get(\"status\")}] {ed.get(\"detail\",\"?\")[:60]}: {raw}')
"
    ;;

  uuid)
    python3 -c "import uuid; print(uuid.uuid4())"
    ;;

  health)
    echo "API health:"
    curl -fsS "$API/v1/health-check" \
      | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('  api:', d['status']); print('  db:', d['info']['db']['status']); print('  queue:', d['info']['workflowQueue']['status']); print('  version:', d['info']['apiVersion']['version'])"
    ;;

  help|--help|-h|*)
    usage
    ;;
esac
