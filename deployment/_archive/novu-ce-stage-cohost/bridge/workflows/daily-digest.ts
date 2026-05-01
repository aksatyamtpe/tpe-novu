import { workflow } from '@novu/framework';
import { z } from 'zod';

/**
 * Daily digest workflow.
 * Exercises: digest step (the core CE feature for batching events).
 *
 * Trigger this workflow once per event (e.g., a comment, a mention).
 * The digest step batches them and emits ONE notification per window.
 */
export const dailyDigest = workflow(
  'daily-activity-digest',
  async ({ step, payload }) => {

    // Digest engine: collect events for 1 hour, then fire downstream steps once
    const digestResult = await step.digest('digest-events', async () => ({
      amount: 1,
      unit: 'hours' as const,
      // Optional digest key — group by, e.g., subscriber + project
      digestKey: payload.projectId,
    }));

    const eventCount = digestResult.events.length;

    // In-app summary
    await step.inApp('inbox-digest', async () => ({
      subject: `${eventCount} new activities`,
      body: digestResult.events
        .slice(0, 5)
        .map((e: any) => `• ${e.payload.summary}`)
        .join('\n') + (eventCount > 5 ? `\n…and ${eventCount - 5} more` : ''),
    }));

    // Email summary
    await step.email('email-digest', async () => ({
      subject: `Your ${eventCount} updates`,
      body: `<h2>${eventCount} new activities</h2><ul>${
        digestResult.events.map((e: any) => `<li>${e.payload.summary}</li>`).join('')
      }</ul>`,
    }));
  },
  {
    payloadSchema: z.object({
      projectId: z.string(),
      summary: z.string(),
    }),
    tags: ['digest', 'engagement'],
  },
);
