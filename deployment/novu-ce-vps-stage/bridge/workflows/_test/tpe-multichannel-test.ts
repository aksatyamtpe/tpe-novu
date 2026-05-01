/**
 * Multi-channel test workflow.
 *
 * NOT a Charter §4.3 trigger. This exists ONLY so the team can verify
 * provider integrations end-to-end.
 *
 * Channel routing on this stage:
 *   - in-app   → Novu native (always works)
 *   - email    → Novu provider integration (configure SES later)
 *   - sms      → MSG91 direct via `step.custom` — Novu CE 2.3.0's worker
 *                does NOT ship msg91/msg91-sms handlers, so we bypass
 *                Novu's SMS abstraction and call MSG91's v2 API ourselves.
 *   - whatsapp → ICPaaS direct via `step.custom` (also not a Novu provider)
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';
import { inAppSkipUnlessEnabled } from '../../lib';

// ---------------------------------------------------------------------------
// Provider config — all sourced from env, never hard-coded.
// Set in docker-compose.yml + .env on the host.
// ---------------------------------------------------------------------------
// ICPaaS (WhatsApp Cloud API)
const ICPAAS_BASE_URL = process.env.ICPAAS_BASE_URL || 'http://www.icpaas.in';
const ICPAAS_PHONE_NUMBER_ID = process.env.ICPAAS_PHONE_NUMBER_ID || '';
const ICPAAS_API_TOKEN = process.env.ICPAAS_API_TOKEN || '';
// The provider's curl example uses `Authorization: Bearer Bearer <token>` (two
// "Bearer" prefixes). Default to the spec-correct single prefix; flip via
// ICPAAS_BEARER_DOUBLE=1 if the provider really wants the doubled form.
const ICPAAS_BEARER_DOUBLE = process.env.ICPAAS_BEARER_DOUBLE === '1';

// MSG91 (SMS)
const MSG91_BASE_URL = process.env.MSG91_BASE_URL || 'https://api.msg91.com';
const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || '';
const MSG91_SENDER_ID = process.env.MSG91_SENDER_ID || '';
const MSG91_ROUTE = process.env.MSG91_ROUTE || '1'; // 1=promotional, 4=transactional
const MSG91_COUNTRY = process.env.MSG91_COUNTRY || '91';

export const tpeMultichannelTest = workflow(
  'tpe-multichannel-test',
  async ({ step, payload }) => {

    // 1) In-app — always fires, no external provider.
    await step.inApp('inbox', async () => ({
      subject: payload.subject,
      body: payload.body,
    }), { skip: inAppSkipUnlessEnabled });

    // 2) Email — configure an Email provider in Dashboard → Integrations.
    //    Subscriber must have `email` set.
    await step.email('email', async () => ({
      subject: payload.subject,
      body: `<p>${payload.body}</p>
<p style="color:#888;font-size:12px;">— TPE staging notification</p>`,
    }));

    // 3) SMS via MSG91 — direct call (Novu CE 2.3.0 lacks the msg91 handler).
    //    Phone is taken from payload.sms.to. For real workflows, prefer
    //    subscriber.phone via Novu's framework — this test workflow keeps
    //    it explicit in the payload to keep the trigger easy to compose.
    await step.custom('sms-msg91', async () => {
      const target = (payload.sms?.to || '').replace(/[^0-9]/g, '');
      if (!target) {
        return { skipped: true, reason: 'payload.sms.to not provided' };
      }
      if (!MSG91_AUTH_KEY || !MSG91_SENDER_ID) {
        return { skipped: true, reason: 'MSG91_AUTH_KEY or MSG91_SENDER_ID not set on bridge' };
      }

      const resp = await fetch(`${MSG91_BASE_URL}/api/v2/sendsms`, {
        method: 'POST',
        headers: {
          authkey: MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: MSG91_SENDER_ID,
          route: MSG91_ROUTE,
          country: MSG91_COUNTRY,
          sms: [{ message: payload.body, to: [target] }],
        }),
      });

      const respText = await resp.text();
      let respJson: unknown;
      try { respJson = JSON.parse(respText); }
      catch { respJson = { raw: respText.slice(0, 500) }; }

      return { httpStatus: resp.status, ok: resp.ok, response: respJson };
    });

    // 4) WhatsApp via ICPaaS — direct HTTP call (not a Novu chat provider).
    //    The custom step's return value goes into the activity feed and is
    //    inspectable via the dashboard's "outputs" panel.
    await step.custom('whatsapp-icpaas', async () => {
      if (!payload.whatsapp) {
        return { skipped: true, reason: 'payload.whatsapp not provided' };
      }
      if (!ICPAAS_API_TOKEN || !ICPAAS_PHONE_NUMBER_ID) {
        return {
          skipped: true,
          reason: 'ICPAAS_API_TOKEN or ICPAAS_PHONE_NUMBER_ID env not set on bridge',
        };
      }

      const auth = ICPAAS_BEARER_DOUBLE
        ? `Bearer Bearer ${ICPAAS_API_TOKEN}`
        : `Bearer ${ICPAAS_API_TOKEN}`;

      const url = `${ICPAAS_BASE_URL}/v23.0/${ICPAAS_PHONE_NUMBER_ID}/messages`;

      const components: unknown[] = [
        { type: 'body', parameters: [] },
      ];
      if (payload.whatsapp.buttonUrlParam) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            { type: 'text', text: payload.whatsapp.buttonUrlParam },
          ],
        });
      }

      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: payload.whatsapp.to,
        type: 'template',
        template: {
          name: payload.whatsapp.templateName,
          language: { code: 'en' },
          components,
        },
        biz_opaque_callback_data: payload.whatsapp.opaqueCallback ?? '',
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
        body: JSON.stringify(body),
      });

      const respText = await resp.text();
      let respJson: unknown;
      try {
        respJson = JSON.parse(respText);
      } catch {
        respJson = { raw: respText.slice(0, 500) };
      }

      return {
        url,
        httpStatus: resp.status,
        ok: resp.ok,
        response: respJson,
      };
    });
  },
  {
    payloadSchema: z.object({
      subject: z.string().default('TPE stage — multichannel test'),
      body: z.string().default('This is a TPE staging environment notification test.'),
      sms: z.object({
        to: z.string().regex(/^\d+$/, 'phone digits only, country-code prefixed'),
      }).optional(),
      whatsapp: z.object({
        to: z.string().regex(/^\d+$/, 'phone digits only, country-code prefixed'),
        templateName: z.string().default('dynamictemp2'),
        buttonUrlParam: z.string().optional(),
        opaqueCallback: z.string().optional(),
      }).optional(),
    }),
    tags: ['_test', 'multichannel', 'pre-charter'],
  },
);
