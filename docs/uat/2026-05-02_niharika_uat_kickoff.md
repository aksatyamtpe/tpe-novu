# UAT Kickoff — Novu CE 3.15.4 Sandbox + Q2=E Full CRUD

**To:** Niharika
**From:** Ashish Kumar Satyam · TPE Engineering · Fairvalue Insuretech (The Policy Exchange)
**Date:** 2026-05-02
**Subject:** TPE Communication System — sandbox is ready for your UAT (login + workflow CRUD + channel preferences)

---

## Email body

Hi Niharika,

The Novu CE 3.15.4 sandbox is now ready for your UAT pass. We deployed the upstream `prod` branch this afternoon, fixed a login-loop bug we discovered during smoke testing, and shipped Q2=E (Full CRUD on workflows) so the dashboard now lets operators create / rename / tag / delete workflows directly — including the 18 Bridge-synced ones imported from our charter code.

### What to test

| URL | http://103.138.96.180:8080 |
| Email | sandbox@tpe-test.local |
| Password | `SandboxStage2026!` |

Please use **Incognito / a private window the first time** — your browser may have cached the old broken bundle.

### The four flows we'd like you to cover

1. **Login**
   - Open the URL → you should land on the sign-in page
   - Enter the credentials above → click Sign In
   - You should land directly on the **Workflows** page (no loop back to sign-in)
   - Sidebar should show "TPE Sandbox 3.15" / "Development" / "sandbox operator"
2. **Create a test workflow**
   - Click **"Create workflow"** (top right)
   - Fill: Name = `UAT Test 1`, Identifier = auto, Description = optional
   - Submit → you should land in the workflow editor with a single TRIGGER node
3. **Edit any of the existing 18 charter workflows** (e.g. `inv-08-premium-due` — our highest-volume one)
   - Click into it → on the right you'll see a Configure-workflow panel
   - Try renaming it (click NAME), adding a tag, toggling Status, marking Critical, changing Notification severity
   - Try clicking **"Configure channel preferences"** → toggle the In-App user-override → toggle it back
4. **Delete the test workflow you created in step 2**
   - From the Workflows list → click the `⋯` action menu on `UAT Test 1` → Delete workflow → Confirm
   - Workflow should disappear from the list

### What's known to work + verified by our smoke test

- Full CRUD on workflows (CREATE / READ / UPDATE / DELETE) — both standard and Bridge-synced
- Add / delete / reorder steps inside a workflow's canvas
- Workflow-level Channel Preferences: Critical, Severity, per-channel default + user override toggles, all writes confirmed via API
- Manage payload schema button — opens schema editor
- The 18 charter workflows still render with all their steps and tags

### What is NOT yet wired up — please don't be alarmed if you hit these

- **Per-step content editor** (in-app body, email subject, SMS text) — middle pane will say "No editor available for this step configuration" because Bridge steps don't ship a uiSchema. We have a Q2=E v2 patch to lift this; landing tomorrow.
- **Sync workflow** menu item is disabled — separate concern, tracked separately
- **AI / workflow-suggestions / templates-novuhq** — these endpoints 404; harmless
- **Inbox provider** is "not connected" — In-App provider config is a follow-up; SMS / WhatsApp / Email already route through our `lib/dispatch.ts` to MSG91 / ICPaaS / SES

### What to send back

For each issue you find, please drop a quick note with:
- The page URL where it happened
- What you clicked / typed
- What you expected vs. what you saw
- A screenshot if it's a visual issue

DM works, or if you prefer email, this thread is fine. I'll triage same-day.

### Background — what changed since the last build

- Pulled upstream Novu prod branch (3.15.0 → 3.15.4)
- Fixed the login loop (caused by a `window.Clerk` module-side-effect collision between two auth shims in the upstream code)
- Shipped Q2=E "Full CRUD" — operator can now edit Bridge-synced workflows from the dashboard, accepting the trade-off that a future `npx novu sync` would re-sync from code and overwrite operator edits
- Image: `tpe-novu-dashboard:3.15.4-tpe-q2e`
- Browser-tested CREATE / READ / UPDATE / DELETE end-to-end against http://103.138.96.180:8080 before sending this

If you hit a wall, ping me and I'll join you on the call.

Thanks!
Ashish

---

## Internal notes (not to send)

- Drafted: 2026-05-02
- Sandbox host: VPS 103.138.96.180 (ports 8080 dashboard, 8081 api, 8083 ws)
- Org `_id`: 69f42e39de8379864fc11148 (TPE Sandbox 3.15)
- Dev env `_id`: 69f42e39de8379864fc1114f
- Prod env `_id`: 69f42e3ade8379864fc11176
- Dashboard image: `tpe-novu-dashboard:3.15.4-tpe-q2e`, bundle `index-CB9Do1zW.js`
- Total workflows in dev env right now: 19 (18 charter + 1 Welcome auto-onboarding)
- All 18 charter still have `origin: external` server-side — Q2=E coercion is FE-only

If Niharika reports the per-step content editor issue: that's the Q2=E v2 work, plan to land same-day after this email if she flags it as blocking.
