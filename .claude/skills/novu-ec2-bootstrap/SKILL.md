---
name: novu-ec2-bootstrap
description: Harden a freshly-launched AL2023 EC2 instance for Novu — install Docker, the compose v2 plugin, swap, harden SSH, prepare /opt/novu. Use when the user says "harden the EC2 box", "install docker on novu host", "bootstrap the host", or "prepare the novu instance".
---

# Bootstrap the AL2023 host for Novu CE

This is **step 2 of 6** in Track B. Run it once, immediately after `novu-ec2-provision`, ideally via SSM Session Manager so no SSH key has to be present yet.

## Prerequisites
- The EC2 instance is reachable via `aws ssm start-session`.
- IAM instance profile already attached (per provision skill).
- You have shell as `ec2-user` or root.

## What the bootstrap does
1. Update the OS and install base packages (`docker`, `git`, `jq`, `amazon-cloudwatch-agent`).
2. Enable Docker, add `ec2-user` to the `docker` group.
3. Install `docker compose` plugin v2.29.0 (manual install — not in AL2023 repos).
4. Disable SSH password authentication (key-only).
5. Add 4 GiB swap (helps Mongo / Redis under memory pressure on the t3.xlarge).
6. Create `/opt/novu` owned by `ec2-user`.

## Recipe (paste into the SSM session as a single block)

```bash
set -euo pipefail

# 1. update system + base packages
sudo dnf update -y
sudo dnf install -y docker git jq amazon-cloudwatch-agent

# 2. enable docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# 3. install docker compose plugin (v2)
DOCKER_CLI_PLUGINS="$HOME/.docker/cli-plugins"
mkdir -p "$DOCKER_CLI_PLUGINS"
curl -SL https://github.com/docker/compose/releases/download/v2.29.0/docker-compose-linux-x86_64 \
  -o "$DOCKER_CLI_PLUGINS/docker-compose"
chmod +x "$DOCKER_CLI_PLUGINS/docker-compose"

# 4. SSH hardening — key-only, no passwords
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# 5. swap (4 GiB)
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# 6. /opt/novu prep
sudo mkdir -p /opt/novu
sudo chown ec2-user:ec2-user /opt/novu
```

After this script, **log out and back in** so the `docker` group membership applies. Then verify:

```bash
docker --version          # 24.x or newer
docker compose version    # v2.29.x
swapon --show             # shows /swapfile, 4G
ls -ld /opt/novu          # owned by ec2-user
sudo ss -tlnp | grep :22  # sshd listening
```

## CloudWatch agent (optional but recommended)

Drop a config under `/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json` that ships:
- `/var/log/messages` to a CloudWatch log group `/novu/pilot/system`
- `/opt/novu/novu-ce-stack/backups/*.log` to `/novu/pilot/backups`
- Mem + disk utilisation metrics every 60s

Then start it:
```bash
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `docker compose version` → command not found | Plugin file in wrong directory or not executable | Check `~/.docker/cli-plugins/docker-compose` exists and is +x |
| `dnf update` 404s | New AL2023 release not yet replicated to the regional mirror | Retry in 10 min, or `sudo dnf clean all && sudo dnf makecache` |
| `swapon` says "Operation not permitted" | EBS volume is provisioned-throughput gp3 with low throughput | Use a `/swapfile` on the root volume rather than a separate volume |
| `ec2-user` still can't run `docker ps` after group add | Old shell session | Log out and back in (or `newgrp docker`) |

## Next step

Invoke **`novu-ce-deploy`** to extract `novu-ce-stack.tar.gz` to `/opt/novu`, run `make bootstrap` (which generates secrets), edit `.env` and Caddyfile for the real hostname, then `make up`.
