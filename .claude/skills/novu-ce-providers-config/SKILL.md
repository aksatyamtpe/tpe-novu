---
name: novu-ce-providers-config
description: Configure the channel providers (SES, MSG91/Gupshup, FCM/APNs, Slack) in the Novu CE dashboard for the TPE Track B pilot. Use when the user says "configure SES", "set up MSG91", "add FCM integration", "wire Slack webhook", or "configure providers in novu".
---

# Configure channel providers in Novu CE

This is **step 4 of 6** in Track B. The dashboard must be running and the first admin already created (see `novu-ce-deploy` step F).

The Charter mandates the failover order **Gupshup → MSG91 → Karix** for SMS / WhatsApp, **SES** for email, **FCM** for push, **Slack** for internal alerting. Configure them in this order so smoke tests can run end-to-end.

## Pre-flight

| Channel | Pre-existing artefact you need |
|---|---|
| Email (SES) | Verified sending domain in SES (DKIM/SPF/DMARC pass), production access (out of sandbox), IAM user with `ses:SendEmail` + `ses:SendRawEmail` scoped to the verified identity ARN |
| SMS (MSG91) | DLT principal entity ID, registered sender header (e.g. `IMGCIN`), at least one DLT template ID, MSG91 Auth Key |
| SMS (Gupshup) | Gupshup API key, registered sender + DLT template IDs (same DLT registration covers both providers) |
| WhatsApp (Gupshup BSP) | Meta business verification complete, WA Business API enabled, BSP-approved templates |
| Push (FCM) | Firebase project, Android app with prod signing key SHA-1, iOS app with APNs Auth Key uploaded, service-account JSON downloaded |
| Chat (Slack) | Slack app with Incoming Webhooks installed, webhook URL per target channel |

## Step A — Email via Amazon SES

Dashboard → **Integrations → Add Integration → Email → Amazon SES**:

| Field | Value |
|---|---|
| Region | `ap-south-1` |
| From email | `notify@your-domain.com` (matches verified identity) |
| From name | `TPE Customer Care` (or audience-appropriate sender per Charter §4.2) |
| Access key ID | from the IAM user |
| Secret access key | from the IAM user |

Test send from the dashboard's **Send Test** button. Check the destination inbox; verify DKIM, SPF, DMARC headers all pass.

**Bounce / complaint handling** is not a Novu config — it's external:
- SNS topic for bounces & complaints subscribed by SES.
- Lambda subscribes to the topic, calls `PATCH /v1/subscribers/{id}` to clear bad credentials or `DELETE /v1/subscribers/{id}` for hard bounces.

## Step B — SMS via MSG91 (primary for India OTP) AND Gupshup (BSP)

For each provider:

Dashboard → **Integrations → Add Integration → SMS → MSG91** (then again for Gupshup):

| Field | Value |
|---|---|
| Auth Key | from MSG91 admin |
| Sender ID | your registered DLT header (e.g. `IMGCIN`) |
| Route | `4` (transactional) for OTP / lifecycle, `1` (promotional) for marketing pushes |

The **DLT Template ID** is passed *per message* via the workflow payload — it's not on the integration form. Workflow code looks like:

```ts
await step.sms('sms-otp', async () => ({
  body: 'Your verification code is {{otp}}. Valid for 5 minutes.',
  // For MSG91, use _passthrough or provider-specific field
  to: subscriber.phone,
}));
```

Per the Charter, the runtime failover is **Gupshup primary, MSG91 second, Karix third** — Operations sets the order in the workflow's provider selection (not a global Novu setting).

> **Don't run two SMS providers as "redundancy" in production** without the Charter §8 change. DLT operators see inconsistent template registrations and may block both.

## Step C — Push via FCM

Dashboard → **Integrations → Add Integration → Push → Firebase Cloud Messaging**:

| Field | Value |
|---|---|
| Service Account Key | paste the entire downloaded JSON |
| Sender ID | Firebase project number |

Subscriber wiring (mobile app side after FCM registration token obtained):
```bash
curl -X POST https://<host>/api/v1/subscribers/<sub_id>/credentials \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"providerId": "fcm",
       "credentials": { "deviceTokens": ["<fcm-token-from-mobile>"] }}'
```

**DPDP note:** FCM payloads transit Google. If push payload contains personal data, document this in the DPDPA DPIA before going live.

## Step D — Chat via Slack

For each Slack channel that should receive alerts (OPS-01 to OPS-05):

Dashboard → **Integrations → Add Integration → Chat → Slack** with the webhook URL.

Subscriber-to-webhook binding:
```bash
curl -X POST https://<host>/api/v1/subscribers/<ops_team_member>/credentials \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"providerId": "slack",
       "credentials": {"webhookUrl": "https://hooks.slack.com/services/..."}}'
```

## Step E — WhatsApp Business (via Gupshup BSP)

Same provider entry as SMS Gupshup, but a separate integration record for the WhatsApp channel. Each WA template must be approved in Meta Business Manager *and* registered with the BSP. Pass the approved template name in the workflow's `step.chat` (or provider-specific) payload.

## Verify

After every provider is added:
```bash
# from your laptop with the API key
curl -fsS -X GET https://<host>/api/v1/integrations \
  -H "Authorization: ApiKey $NOVU_API_KEY" | jq '.data[] | {channel, providerId, active}'
```

Each Charter-required provider should appear with `active: true`.

## Best-practice reminders (PROVIDERS.md §11)

1. **One provider per channel per environment** for production.
2. **Test bounce / failure handling before relying on it.** Send a known-bad SES address, verify suppression Lambda updates Novu.
3. **Reconcile delivery counts daily.** India SMS DLT failures often appear as silent non-delivery; <95% delivered over 24h = P2 incident.
4. **Rotate provider keys annually with overlap** (add new, verify, remove old) — never replace.
5. **Document fallback behaviour.** Default Novu behaviour is mark-failed; rarely what business wants for OTP / critical comms.

## Next step

Invoke **`novu-ce-bridge-sync`** to push the four sample workflows (and later the 49 TPE workflows) from `bridge/workflows/` into the dashboard's Development environment.
