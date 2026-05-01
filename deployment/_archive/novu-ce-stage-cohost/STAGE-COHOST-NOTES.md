# Novu CE Stage Co-Host Profile

A variant of the bundled `novu-ce-stack` adapted to run on the **shared eKYC
stage EC2 host** (`3.6.216.138`, ap-south-1, AL2023, aarch64) alongside the
existing `video-kyc-webrtc` and `enterprise_devsecops` stacks.

This profile exists so the team can stand up a Novu staging environment
**without provisioning a new EC2 instance** and **without touching any
existing service** on the host.

---

## What's different vs. the canonical bundle

| Concern | Canonical bundle | Stage co-host profile |
|---|---|---|
| Reverse proxy | Caddy (`:80` + `:443`, auto-TLS) | **omitted** — eKYC nginx already owns 80/443 |
| API host port | `127.0.0.1:3000` | **`127.0.0.1:13000`** (3000 is held by `devsecops-admin`) |
| WS host port | `127.0.0.1:3002` | **`127.0.0.1:13002`** (consistency with API remap) |
| Dashboard host port | `127.0.0.1:4000` | **`127.0.0.1:14000`** (consistency) |
| Bridge host port | `127.0.0.1:4001` | **`127.0.0.1:14001`** (consistency) |
| Public access | Browser → `https://novu.your-domain.com` | **AWS SSM port-forwarding** → `http://localhost:14000` |
| TLS | Let's Encrypt via Caddy | not in scope (loopback-only on host; tunnel is encrypted by SSM) |
| `.env` URLs | hostname-based | `localhost:<remapped-port>` (matches the SSM tunnel target) |

Everything else — Mongo, Redis-queue, Redis-cache, LocalStack, Bridge, the
sample workflows, the smoke test, the backup/upgrade scripts — is unchanged
from the canonical bundle.

---

## Why this shape

1. **No risk to the eKYC service.** The `video-kyc-hosting-nginx-1` config is
   never edited. The video-KYC team's deploys never see a Novu-shaped change.
2. **No new AWS spend.** No ALB, no ACM cert, no Route 53 record, no extra EBS.
3. **Stage-appropriate access pattern.** Devs and QA tools tunnel to the
   dashboard via SSM as needed; nothing browse-able from the open internet.
4. **Reversible.** Removing this stack is `cd /opt/novu/novu-ce-stage-cohost && make down && make nuke` — the rest of the host is untouched.

---

## Access recipe (developer laptop)

```bash
# One-time prerequisite (mac):
brew install --cask session-manager-plugin

# Start the four port forwards in the background:
cd /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/deployment/novu-ce-stage-cohost
./scripts/ssm-tunnel.sh all
```

Then in the browser:
- Dashboard:  http://localhost:14000
- API:        http://localhost:13000  (e.g. `/v1/health-check`)
- Bridge:     http://localhost:14001/api/novu

`Ctrl+C` in the tunnel terminal closes all four sessions cleanly.

---

## Deploy recipe (one-time, on the host)

```bash
# 1. Upload the bundle (from your laptop)
tar -czf /tmp/novu-ce-stage-cohost.tar.gz \
    -C /Users/aksatyam/SelfWork/TPE_WORK/Projetcs/novu-notification-system/deployment \
    novu-ce-stage-cohost
scp -i tpe-stage-ekyc.pem /tmp/novu-ce-stage-cohost.tar.gz \
    ec2-user@3.6.216.138:/tmp/

# 2. Extract on the host
ssh -i tpe-stage-ekyc.pem ec2-user@3.6.216.138 \
    "sudo mkdir -p /opt/novu && sudo chown ec2-user:ec2-user /opt/novu && \
     tar -xzf /tmp/novu-ce-stage-cohost.tar.gz -C /opt/novu/"

# 3. Bootstrap secrets and bring up
ssh -i tpe-stage-ekyc.pem ec2-user@3.6.216.138 \
    "cd /opt/novu/novu-ce-stage-cohost && make bootstrap && make up"

# 4. First admin & lockdown — tunnel the dashboard port from your laptop:
./scripts/ssm-tunnel.sh dashboard
# Open http://localhost:14000 → register first admin → copy API key → 
# set DISABLE_USER_REGISTRATION=true in .env → restart dashboard.

# 5. Sync sample workflows (run on the host)
ssh -i tpe-stage-ekyc.pem ec2-user@3.6.216.138 \
    "cd /opt/novu/novu-ce-stage-cohost && make sync"

# 6. Smoke test (run on the host with NOVU_API_KEY exported)
ssh -i tpe-stage-ekyc.pem ec2-user@3.6.216.138 \
    "cd /opt/novu/novu-ce-stage-cohost && NOVU_API_KEY=novu_xxx make smoke"
```

---

## Remaining caveats (stage-acceptable, prod-blocking)

1. **WebRTC UDP buffer pressure.** During live KYC sessions, LiveKit/TURN
   compete for kernel UDP buffers; Novu's BullMQ Redis tail latency may rise
   during peak eKYC traffic. Monitor `redis-queue` latency if this matters
   for your test scenarios.
2. **Disk ceiling.** ~21 GiB free on `/dev/nvme0n1p1`. Mongo + LocalStack
   data + Docker layers will consume ~10 GiB at moderate use. If you push
   high message volume in stage, attach a separate EBS volume for `/var/lib/docker`.
3. **No HA.** Single-host. If the host reboots, the stack restarts (compose
   `restart: unless-stopped`) but there's a brief outage window. Stage-OK.
4. **No public DNS.** This profile is intentionally not browseable without
   SSM. Don't promote this profile to prod — use `novu-ce-stack` (with Caddy)
   on a dedicated instance, or Track A (Terraform) for production.

---

## Removal (if/when needed)

```bash
ssh -i tpe-stage-ekyc.pem ec2-user@3.6.216.138 << 'REMOTE'
cd /opt/novu/novu-ce-stage-cohost
make down
echo DELETE | make nuke         # destroys volumes
docker rmi $(docker images -q --filter 'reference=ghcr.io/novuhq/novu/*') || true
sudo rm -rf /opt/novu/novu-ce-stage-cohost
REMOTE
```

This leaves the eKYC and DevSecOps stacks untouched.
