/**
 * Phase 0 placeholder workflow.
 *
 * This workflow exists ONLY so the smoke test (`make smoke`) has something
 * to trigger. It will be replaced by the real Charter §4.3 workflows starting
 * with PH-02 Registration as the first exemplar.
 *
 * It deliberately uses none of the lib/ helpers — those land starting in
 * PH-02 so the auditing/compliance/locale/insurer-routing patterns are
 * established correctly the first time.
 */
import { workflow } from '@novu/framework';
import { inAppSkipUnlessEnabled } from '../lib';

export const welcomeOnboarding = workflow(
  'welcome-onboarding',
  async ({ step }) => {
    await step.inApp('inbox-welcome', async () => ({
      subject: 'Welcome to Novu (TPE stage)',
      body: 'Your stage notification stack is live. Replace this with real PH-XX/INV-XX workflows per Charter §4.3.',
    }), { skip: inAppSkipUnlessEnabled });
  },
);
