# Provider Integration Reference

Configuration for every CE-supported channel. All providers are added via
**Dashboard → Integrations → Add Integration** unless noted otherwise.

---

## 1. In-App Inbox

Provider: **Novu** (built-in). No external account needed.

**Frontend wiring:**

```bash
npm install @novu/react
```

```tsx
import { Inbox } from '@novu/react';

<Inbox
  applicationIdentifier="<from dashboard → Settings → Application>"
  subscriberId={user.id}
  // For self-hosted Novu — point to YOUR backend, not novu.co
  backendUrl="https://novu.your-domain.com/api"
  socketUrl="wss://novu.your-domain.com/ws"
/>
```

---

## 2. Email — Amazon SES (recommended)

**Pre-requisites:**
1. Verify the sending domain in SES (DKIM, SPF, DMARC). Use a sub-domain
   like `notify.example.com` to isolate sender reputation.
2. Request production access (out of sandbox). State expected daily volume
   and bounce-handling approach.
3. Create an IAM user with `ses:SendEmail` and `ses:SendRawEmail` scoped to
   the verified identity ARN.

**Bounce / complaint handling:**
- Create an SNS topic for bounces and complaints.
- Configure SES to publish to it.
- Subscribe a Lambda that suppresses bounced/complained addresses via the
  Novu API: `PATCH /v1/subscribers/{id}` with `channels[].credentials`
  cleared, or `DELETE /v1/subscribers/{id}` for hard bounces.

**Novu integration form:**
- Region: `ap-south-1` (or your verified region)
- From email: `notify@your-domain.com` (matches SES verified identity)
- From name: `Your Brand Name`
- Access key ID / secret: from the IAM user created above

---

## 2a. Email — Alternative providers

| Provider   | When to choose                              | Caveat |
|------------|---------------------------------------------|--------|
| SendGrid   | Quick start, simple billing                 | US/EU hosted — DPDP DPIA required |
| Postmark   | Best deliverability for transactional       | Higher unit cost |
| Mailgun    | Marketing + transactional in one account    | EU/US data residency only |
| SMTP       | When using corporate Exchange / Postfix     | No analytics surface |

---

## 3. SMS — India (DLT-compliant)

India SMS requires DLT (Distributed Ledger Technology) registration with
TRAI. Non-registered messages are blocked at the operator level.

### MSG91

**Setup:**
1. Complete DLT registration with the TRAI-registered access provider
   (Vodafone-Idea Smart Ping, Jio True Connect, etc.)
2. Register your sender ID (header) — typically a 6-character alphanumeric
   for transactional (e.g., `IMGCIN`, `AXISLF`).
3. Register every SMS template you will send. Capture the DLT template ID
   for each. Variable placeholders use `{#var#}` format.
4. In MSG91 admin, link the DLT principal entity ID and template IDs.

**Novu integration form:**
- Auth Key: from MSG91 dashboard
- Sender ID: your registered header
- Route: `4` (transactional) or `1` (promotional)
- DLT Template ID: passed per-message via the workflow payload

**Workflow usage:**
```ts
await step.sms('otp', async () => ({
  body: 'Your OTP is {{otp}}. Valid for 5 minutes.',
  // MSG91-specific overrides
  to: subscriber.phone,
  // Pass DLT template ID via _passthrough or provider-specific config
}));
```

### Gupshup

Equivalent setup. Gupshup's WhatsApp Business API also requires Meta business
verification — separate process from SMS DLT.

### Twilio (international, low volume only)

Suitable for non-IN numbers. Avoid for India bulk transactional.

---

## 4. Push — Firebase Cloud Messaging (FCM)

**Setup:**
1. Create a Firebase project at https://console.firebase.google.com.
2. Add your Android app (with the production signing key SHA-1) and iOS app
   (upload your APNs Authentication Key from Apple Developer).
3. Generate a service account JSON: **Project Settings → Service Accounts
   → Generate New Private Key**.

**Novu integration form:**
- Service Account Key: paste the entire JSON
- Sender ID (project number): from Firebase project settings

**Subscriber wiring:**
The mobile app obtains an FCM device token and registers it with Novu:
```bash
POST /v1/subscribers/{subscriberId}/credentials
{
  "providerId": "fcm",
  "credentials": { "deviceTokens": ["<fcm-device-token>"] }
}
```

**DPDP note:** FCM payloads transit Google. If push payload contains
personal data, document this in your DPDP DPIA.

---

## 5. Push — APNs (direct, without FCM)

Use only if your iOS app does not include the Firebase SDK. Direct APNs
requires an APNs Authentication Key (`.p8`) from Apple Developer.

**Novu integration form:**
- Key ID, Team ID, Bundle ID, .p8 contents
- Production / Sandbox toggle (must match your build configuration)

---

## 6. Chat — Slack

For internal alerting and ops escalation.

**Setup:**
1. Create a Slack app at https://api.slack.com/apps.
2. Add Incoming Webhooks feature; install to workspace.
3. Create a webhook for the target channel.

**Subscriber wiring:**
```bash
POST /v1/subscribers/{subscriberId}/credentials
{
  "providerId": "slack",
  "credentials": { "webhookUrl": "https://hooks.slack.com/services/..." }
}
```

---

## 7. Chat — Microsoft Teams

Same pattern as Slack — incoming webhook URL per channel.

---

## 8. Chat — Discord

Use only for community / non-corporate notifications. Webhook-based.

---

## 9. WhatsApp Business

Available via Twilio, Gupshup, or Infobip. Requires Meta Business
verification + WhatsApp message template approval. Treat as a separate
project, not a checkbox.

---

# Provider Configuration Best Practices

1. **One provider per channel per environment.** Don't run two SMS
   providers in production "for redundancy" — DLT operators will see
   inconsistent template registrations and may block both.

2. **Test bounce/failure handling before relying on it.** Send a known-bad
   address to SES; verify the suppression Lambda catches it and updates
   Novu.

3. **Reconcile delivery counts daily.** Especially India SMS — DLT failures
   often appear as silent non-delivery. Compare Novu's "sent" count to the
   provider's "delivered" count. Drop below 95% over 24h = P2 incident.

4. **Rotate provider keys annually.** Use Secrets Manager + the provider
   admin UI to rotate. Always overlap (add new, verify, remove old) — never
   replace.

5. **Document fallback behavior.** If a provider is down, what does the
   workflow do? Default Novu behavior is mark-failed; rarely is that what
   the business wants for OTP/critical comms.
