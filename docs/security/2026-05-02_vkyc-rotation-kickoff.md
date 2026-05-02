# vkyc-webrtc Secret Rotation — Kickoff Note

**Status:** PENDING — dedicated session required
**Severity:** 🔴 CRITICAL (one cert) + 🟠 HIGH (two SSH keys)
**Discovery date:** 2026-05-01
**Document:** TPE-SEC-2026-001
**Owner (proposed):** TBD — needs CTO assignment
**Reference memory:** `~/.claude/projects/.../memory/vkyc_repo_secret_leak.md`

---

## Why this needs its own session, not a tail-on to today's work

Today's session was Novu CE / dashboard fork / Q2=E. The vkyc rotation:

1. Touches a **different repo** (`Fairvalue-Insuretech/video-kyc-webrtc`) — different access patterns, different CI/CD
2. Has **production-traffic blast radius** if mis-handled (GoDaddy cert revocation could break inadev.net subdomains)
3. Requires **coordinated stakeholder ack** before execution: Infra Lead, Compliance, possibly a registrar / CA contact at GoDaddy
4. Phase 1 (rotate) MUST happen before Phase 3 (history rewrite) — sequencing matters; mixing this with workflow / dashboard work risks dropping a step
5. Time budget is its own thing: ~1-2 days Phase 1, then 4 hours Phase 2, then 2 hours Phase 3 — best done with focus

Bundling it with UAT / cutover work would dilute attention and is the kind of mistake that creates incidents. **Do it as a dedicated 1-day session.**

## What's leaked (recap from `memory/vkyc_repo_secret_leak.md`)

| File | Type | Severity |
|---|---|---|
| `infra/nginx/ssl/privkey.pem` | GoDaddy `*.inadev.net` wildcard SSL private key | 🔴 CRITICAL |
| `tpe-stage-ekyc.pem` | RSA SSH key — legacy eKYC server (retired 2026-04-30) | 🟠 HIGH |
| `tpe-bulk-import.pem` | RSA SSH key — purpose TBD | 🟠 HIGH |

All three at HEAD on `Fairvalue-Insuretech/video-kyc-webrtc` since Feb 2026. Treat all as fully compromised — anyone with repo read access has had ~3 months of access.

## Three-phase plan (per the memory doc — refined here for kickoff)

### Phase 1 — Rotate (CRITICAL, MUST be first)

| # | Task | Owner | Time |
|---|---|---|---|
| 1 | Issue new wildcard SSL cert for `*.inadev.net` (GoDaddy or alternative CA) | Infra | 4-8 hr (CA processing) |
| 2 | Deploy new cert to all inadev.net subdomains | Infra | 1 hr |
| 3 | Revoke compromised GoDaddy cert | Infra + Compliance | 30 min |
| 4 | Generate new SSH keypair for tpe-stage-ekyc replacement service account | Infra | 15 min |
| 5 | Update authorized_keys on every host where the old public key exists (audit list) | Infra | 1-2 hr |
| 6 | If `tpe-bulk-import.pem` authenticates a service account (e.g. for bulk customer-data imports), rotate that account's credentials | Backend Lead | TBD |

Cannot proceed to Phase 2/3 until ALL of Phase 1 is complete.

### Phase 2 — Cleanup at HEAD

| # | Task | Owner | Time |
|---|---|---|---|
| 1 | Remove `infra/nginx/ssl/privkey.pem`, `tpe-stage-ekyc.pem`, `tpe-bulk-import.pem` from HEAD | Engineering | 15 min |
| 2 | Add to `.gitignore` patterns for `*.pem`, `*.key`, common credential filenames | Engineering | 5 min |
| 3 | Add a pre-commit hook (gitleaks / trufflehog) to block future commits | Engineering | 1 hr |
| 4 | Commit, push, verify | Engineering | 10 min |

### Phase 3 — History rewrite (optional, but recommended)

Use `git filter-repo` to rewrite all three files out of git history. Touches commit hashes — every collaborator must re-clone afterwards.

| # | Task | Owner | Time |
|---|---|---|---|
| 1 | Backup the repo (full mirror clone) | Engineering | 5 min |
| 2 | Run `git filter-repo --path <file> --invert-paths` for each leaked file | Engineering | 15 min |
| 3 | Force-push to GitHub | Engineering | 5 min |
| 4 | Notify all collaborators to re-clone | Engineering | 5 min comm time |
| 5 | Verify GitHub UI no longer shows the files at any commit | Engineering | 10 min |
| 6 | Update memory file with completion status | Engineering | 5 min |

## Open questions for the dedicated session

1. **Who owns Phase 1 rotation tasks?** — likely Infra, but tpe-bulk-import owner is TBD
2. **What's the public-key audit scope for the eKYC SSH key?** — which Fairvalue hosts need their authorized_keys checked
3. **Acceptable inadev.net downtime during cert swap?** — minutes vs hours
4. **Compliance reporting requirement?** — DPDPA / IRDAI may require reporting if any leaked key authenticated to a system holding personal data

## When to schedule

**Recommended: within 7 days** — the keys have been exposed for 3 months already. Once UAT for Novu sandbox is moving (D from this session), there's no reason to delay further.

Suggested order if executing alongside Novu work:
1. Today (2026-05-02): Niharika UAT email sent (D)
2. 2026-05-03 (Mon): Niharika feedback ingested
3. 2026-05-04 or 05: **Dedicated vkyc rotation day** (Phase 1+2; Phase 3 can be the next day)
4. 2026-05-06+: Production cutover prep (B)

## Action items right now

- [ ] CTO assigns Phase 1 owner
- [ ] Schedule the dedicated session in the calendar
- [ ] Create a TPE-SEC-2026-001 tracking ticket (Jira/Linear/etc.)
- [ ] Notify stakeholders this is queued — link to this doc + the memory file

---

**This kickoff note exists to ensure rotation work is not forgotten between sessions.**

Reference: full audit + remediation plan in `~/.claude/projects/-Users-aksatyam-SelfWork-TPE-WORK-Projetcs-novu-notification-system/memory/vkyc_repo_secret_leak.md`.
