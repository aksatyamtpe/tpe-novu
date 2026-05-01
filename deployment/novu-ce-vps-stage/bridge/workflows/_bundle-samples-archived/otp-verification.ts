import { workflow } from '@novu/framework';
import { z } from 'zod';

/**
 * OTP workflow — SMS first, email fallback.
 * Exercises: SMS step, conditional skip via skip(), short payload schema.
 */
export const otpVerification = workflow(
  'otp-verification',
  async ({ step, payload }) => {

    // SMS — primary channel for OTP in India context
    await step.sms('sms-otp', async () => ({
      body: `Your verification code is ${payload.otp}. Valid for 5 minutes. Do not share with anyone.`,
    }));

    // Email fallback — only sent if subscriber has no phone on file
    await step.email('email-otp-fallback', async () => ({
      subject: 'Your verification code',
      body: `<p>Your verification code is <strong>${payload.otp}</strong>. Valid for 5 minutes.</p>`,
    }), {
      skip: async (_, { subscriber }) => Boolean(subscriber.phone),
    });
  },
  {
    payloadSchema: z.object({
      otp: z.string().length(6),
    }),
    tags: ['authentication', 'transactional'],
  },
);
