import { workflow } from '@novu/framework';
import { z } from 'zod';

/**
 * Welcome / Onboarding workflow.
 * Exercises: in-app + email + push, with payload + control schemas.
 *
 * Trigger:
 *   POST /v1/events/trigger
 *   { name: "welcome-onboarding", to: { subscriberId: "..." }, payload: {...} }
 */
export const welcomeOnboarding = workflow(
  'welcome-onboarding',
  async ({ step, payload, subscriber }) => {

    // ----- 1) In-app inbox notification -----
    await step.inApp('inbox-welcome', async (controls) => ({
      subject: `Welcome, ${subscriber.firstName ?? 'there'}!`,
      body: controls.body,
      avatar: controls.avatarUrl,
      primaryAction: {
        label: controls.primaryCtaLabel,
        redirect: { url: payload.dashboardUrl, target: '_self' },
      },
    }), {
      controlSchema: z.object({
        body: z.string().default('Thanks for signing up. Take a quick tour.'),
        avatarUrl: z.string().url().default('https://avatar.example.com/welcome.png'),
        primaryCtaLabel: z.string().default('Open dashboard'),
      }),
    });

    // ----- 2) Email -----
    await step.email('email-welcome', async (controls) => ({
      subject: controls.subject,
      body: `
        <h1>Welcome, ${subscriber.firstName ?? 'there'}</h1>
        <p>${controls.bodyHtml}</p>
        <p><a href="${payload.dashboardUrl}">${controls.ctaLabel}</a></p>
      `,
    }), {
      controlSchema: z.object({
        subject: z.string().default('Welcome aboard'),
        bodyHtml: z.string().default('We are glad to have you. Click below to get started.'),
        ctaLabel: z.string().default('Open dashboard'),
      }),
    });

    // ----- 3) Push (mobile) -----
    await step.push('push-welcome', async () => ({
      subject: 'Welcome!',
      body: 'Tap to finish setting up your account.',
    }));
  },
  {
    payloadSchema: z.object({
      dashboardUrl: z.string().url(),
    }),
    tags: ['onboarding', 'transactional'],
  },
);
