# CE Feature Exercise Checklist

A walk-through of every Community Edition capability. Tick each box after
verifying it in your stack. If something doesn't work, you don't have
"all features" — you have a partial deployment.

> Reminder: RBAC, SAML/OIDC SSO, organization-level audit logs, advanced
> analytics, and certain workflow features are **not** in CE — they are
> Enterprise Edition only. Items below are scoped to what CE actually
> ships.

---

## 1. Service Health

- [ ] `make ps` shows all services `running (healthy)`:
      mongodb, redis-queue, redis-cache, localstack, api, worker, ws,
      dashboard, bridge, caddy
- [ ] `curl https://novu.your-domain.com/api/v1/health-check` returns `{"status":"ok"}`
- [ ] Dashboard loads at `https://novu.your-domain.com/`
- [ ] Bridge endpoint returns valid discovery payload at
      `https://novu.your-domain.com/bridge/api/novu`

## 2. First-Run Setup

- [ ] Created first admin account via dashboard
- [ ] **Set `DISABLE_USER_REGISTRATION=true`** and restarted dashboard service
- [ ] Created at least one Organization
- [ ] Generated and copied API Secret Key (Settings → API Keys)
- [ ] Two environments visible: Development, Production

## 3. Subscriber Management

- [ ] Created a subscriber via API: `POST /v1/subscribers`
- [ ] Read subscriber back: `GET /v1/subscribers/{id}`
- [ ] Updated subscriber attributes (firstName, email, phone)
- [ ] Added per-channel credentials (FCM device token, Slack webhook)
- [ ] Bulk created subscribers via the bulk endpoint
- [ ] Deleted a subscriber

## 4. Topics (broadcast)

- [ ] Created a topic: `POST /v1/topics`
- [ ] Added subscribers to the topic
- [ ] Triggered to a topic: `POST /v1/events/trigger` with
      `to: { type: "Topic", topicKey: "..." }`
- [ ] Verified all topic members received the notification
- [ ] Removed a subscriber from the topic

## 5. Workflow — In-App Channel

- [ ] Triggered the `welcome-onboarding` workflow
- [ ] In-app notification appeared in the embedded `<Inbox/>` component
- [ ] Click-through (`primaryAction.redirect`) works
- [ ] "Mark as read" updates state (verify in dashboard → Activity Feed)
- [ ] WebSocket delivers in real time (no page refresh needed)

## 6. Workflow — Email Channel

- [ ] Email arrives at the test inbox
- [ ] HTML rendering correct (subject, body, CTA)
- [ ] Sender domain authenticated (DKIM pass, SPF pass, DMARC aligned)
- [ ] Bounce-handling path tested with a known-bad address
- [ ] Activity Feed (Dashboard → Activity Feed) shows status: `Sent`

## 7. Workflow — SMS Channel

- [ ] SMS delivered to test number (India: DLT template registered)
- [ ] Template variables interpolated correctly (`{{otp}}`)
- [ ] Failure path tested (invalid number) — Activity Feed shows `Failed`
- [ ] DLT template ID present in provider logs

## 8. Workflow — Push Channel

- [ ] Mobile device receives push notification
- [ ] Tapping deep-links into the app correctly
- [ ] Inactive token cleanup works (uninstall app, retry, no crash)

## 9. Workflow — Chat Channel

- [ ] Slack message posted to the configured webhook channel
- [ ] (Optional) Teams / Discord parity tested

## 10. Workflow Engine — Step Types

- [ ] **Digest step** (`step.digest`) — triggered the `daily-activity-digest`
      workflow N times within the digest window; received ONE summary
      notification with N events
- [ ] **Delay step** (`step.delay`) — triggered `policy-update`; verified
      escalation fired after the delay window (use `amount: 1, unit: 'minutes'`
      for testing, not 24 hours)
- [ ] **Custom step** (`step.custom`) — verified the external API call ran
      and `outputSchema` was respected
- [ ] **Conditional skip** (`skip:`) — verified the email-fallback in
      `otp-verification` is skipped when the subscriber has a phone

## 11. Code-First Workflows (Bridge)

- [ ] `make sync` syncs all Bridge workflows to the dev environment
- [ ] Synced workflows visible in Dashboard → Workflows (read-only badge)
- [ ] Changes to workflow code + `make sync` updates the workflow in the
      dashboard

## 12. Visual Workflow Editor (Dashboard-authored)

- [ ] Created a new workflow in the dashboard (without Bridge)
- [ ] Added in-app + email + SMS steps
- [ ] Triggered it via API and verified all steps fired

## 13. Multi-Environment Promotion

- [ ] Edited a workflow in Development
- [ ] Promoted to Production via Dashboard → Changes
- [ ] Production trigger executes the new version
- [ ] Production has its own API keys (different from Development)

## 14. Subscriber Preferences

- [ ] Subscriber preference page shows the workflow with channel toggles
- [ ] Disabling a channel for a subscriber prevents that channel from firing
- [ ] Workflow-level preference defaults are honored
- [ ] Preference changes take effect on the next trigger (no cache lag)

## 15. Layouts (Email Layout templates)

- [ ] Created a layout in Dashboard → Layouts
- [ ] Referenced the layout from an email step
- [ ] Updated the layout — change reflected in the next email sent

## 16. Translations / i18n

- [ ] Configured supported locales (e.g., `en`, `hi`, `ta`)
- [ ] Subscriber `locale` attribute drives content selection
- [ ] Verified content renders correctly in non-English locale

## 17. Tenants (multi-tenancy)

- [ ] Created a tenant: `POST /v1/tenants`
- [ ] Triggered a workflow with `actor` and `tenant` set
- [ ] Verified per-tenant content overrides apply

## 18. Activity Feed & Logs

- [ ] Activity Feed shows every triggered workflow with step-by-step status
- [ ] Failed steps surface error reason
- [ ] Filter by subscriber, workflow, status works

## 19. Object Storage

- [ ] Workflow with email layout / attachment writes to `S3_BUCKET_NAME`
- [ ] Files are readable / signed-URL retrievable
- [ ] (Production) LocalStack replaced with real S3 bucket; `S3_LOCAL_STACK`
      is empty

## 20. Operational Hygiene

- [ ] `./scripts/backup.sh` produces a non-empty backup folder
- [ ] Backup tested: restored to a sandbox stack, data parity verified
- [ ] `./scripts/upgrade.sh` runs cleanly through to the migration prompt
- [ ] Caddy automatically obtained the TLS certificate (no manual cert ops)
- [ ] `make smoke` passes end-to-end with no manual intervention

---

## What CE does NOT give you

These items will fail an enterprise security review and are not solvable
through CE configuration. Scope them as Enterprise Edition or compensating
controls in your security plan.

- [ ] ❌ RBAC (role-based access for dashboard users)
- [ ] ❌ SAML / OIDC SSO
- [ ] ❌ Organization-level audit logs (who changed what, when)
- [ ] ❌ Advanced analytics (channel-level conversion, cohort)
- [ ] ❌ HIPAA BAA (Novu offers this only on Cloud / EE)
- [ ] ❌ SOC 2 inheritable controls (must be deployed under your own
        SOC 2 scope)

If any of those is required, either license Novu Enterprise Edition or
write a documented compensating-control plan covering each gap.
