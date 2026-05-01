import { workflow } from '@novu/framework';
import { z } from 'zod';

/**
 * Policy update workflow.
 * Exercises: delay step, custom step (call external API), chat step (Slack).
 *
 * Use case: BFSI policy update. Notify customer immediately, wait 24h, then
 * if not acknowledged, escalate to internal Slack channel.
 */
export const policyUpdate = workflow(
  'policy-update',
  async ({ step, payload }) => {

    // 1) Immediate email to policyholder
    await step.email('email-policy-update', async () => ({
      subject: `Important update to your policy ${payload.policyNumber}`,
      body: `<p>Dear ${payload.customerName},</p>
             <p>${payload.changeSummary}</p>
             <p><a href="${payload.acknowledgeUrl}">Acknowledge</a></p>`,
    }));

    // 2) In-app inbox notification
    await step.inApp('inbox-policy-update', async () => ({
       subject: 'Policy update',
       body: payload.changeSummary,
       primaryAction: {
         label: 'Acknowledge',
         redirect: { url: payload.acknowledgeUrl, target: '_self' },
       },
    }));

    // 3) Wait 24 hours (delay step)
    await step.delay('wait-24h', async () => ({
      type: 'regular' as const,
      amount: 24,
      unit: 'hours' as const,
    }));

    // 4) Custom step — check acknowledgement status from upstream system
    const ack = await step.custom('check-acknowledgement', async () => {
      const res = await fetch(`${process.env.POLICY_SVC_URL}/policies/${payload.policyNumber}/ack`, {
        headers: { Authorization: `Bearer ${process.env.POLICY_SVC_TOKEN}` },
      });
      const data = await res.json() as { acknowledged: boolean };
      return { acknowledged: data.acknowledged };
    }, {
      outputSchema: z.object({ acknowledged: z.boolean() }),
    });

    // 5) Escalate to internal Slack ops channel if still not acknowledged
    await step.chat('slack-escalate', async () => ({
      body: `:warning: Policy ${payload.policyNumber} not acknowledged after 24h. Customer: ${payload.customerName}`,
    }), {
      skip: async () => ack.acknowledged,
    });
  },
  {
    payloadSchema: z.object({
      policyNumber: z.string(),
      customerName: z.string(),
      changeSummary: z.string(),
      acknowledgeUrl: z.string().url(),
    }),
    tags: ['policy', 'compliance'],
  },
);
