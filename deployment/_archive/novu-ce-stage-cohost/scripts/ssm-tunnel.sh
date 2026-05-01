#!/usr/bin/env bash
# =============================================================================
# Novu CE Stage Co-Host — SSM Port-Forward Helper
# -----------------------------------------------------------------------------
# Tunnels the loopback-bound Novu service ports from the eKYC stage host to
# the developer's laptop, so the dashboard / API / Bridge are reachable at
# http://localhost:* without ever opening a public port on the EC2 instance.
#
# Usage:
#   ./ssm-tunnel.sh              # tunnel all four ports (default)
#   ./ssm-tunnel.sh dashboard    # only 14000
#   ./ssm-tunnel.sh api          # only 13000
#   ./ssm-tunnel.sh ws           # only 13002
#   ./ssm-tunnel.sh bridge       # only 14001
#
# Prerequisites on developer's laptop:
#   - aws CLI v2 (with `session-manager-plugin` installed)
#   - AWS credentials with `ssm:StartSession` on the target instance
#
# The instance ID is derived from the IP at runtime; if the eKYC host moves,
# update STAGE_HOST_IP below.
# =============================================================================
set -euo pipefail

STAGE_HOST_IP="${STAGE_HOST_IP:-3.6.216.138}"
AWS_REGION="${AWS_REGION:-ap-south-1}"

# Resolve EC2 instance ID from the public IP.
INSTANCE_ID="$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --filters "Name=ip-address,Values=$STAGE_HOST_IP" \
  --query 'Reservations[].Instances[].InstanceId' \
  --output text 2>/dev/null || true)"

if [[ -z "${INSTANCE_ID:-}" || "$INSTANCE_ID" == "None" ]]; then
  echo "ERROR: Could not resolve instance ID for $STAGE_HOST_IP in $AWS_REGION." >&2
  echo "       Set INSTANCE_ID=i-xxx in the env to override:" >&2
  echo "         INSTANCE_ID=i-xxx ./scripts/ssm-tunnel.sh" >&2
  : "${INSTANCE_ID:?}"
fi

declare -A PORTS=(
  [dashboard]=14000
  [api]=13000
  [ws]=13002
  [bridge]=14001
)

start_tunnel() {
  local name="$1" port="${PORTS[$1]}"
  echo "[ssm-tunnel] $name → http://localhost:$port  (instance $INSTANCE_ID)"
  aws ssm start-session \
    --region "$AWS_REGION" \
    --target "$INSTANCE_ID" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "portNumber=[\"$port\"],localPortNumber=[\"$port\"]" &
}

case "${1:-all}" in
  dashboard|api|ws|bridge)
    start_tunnel "$1"
    wait
    ;;
  all)
    for svc in dashboard api ws bridge; do
      start_tunnel "$svc"
      sleep 1     # stagger session starts; SSM rate-limits parallel new sessions
    done
    echo "[ssm-tunnel] all four tunnels started; press Ctrl+C to stop them."
    wait
    ;;
  *)
    echo "Usage: $0 [dashboard|api|ws|bridge|all]" >&2
    exit 2
    ;;
esac
