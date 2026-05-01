/**
 * PH-14 Loan Disbursement — Policyholder Lifecycle.
 *
 * Charter §4.3.1 trigger spec:
 *   "Confirm loan-amount disbursement to bank account."
 *   Channels: SMS, WhatsApp — immediate, no email per Charter (cash event;
 *             customer wants the SMS-on-phone confirmation).
 *   Cadence:  Single-shot.
 *   Quiet hours: NOT applied — financial confirmation, transactional class.
 */
import { workflow } from '@novu/framework';
import { z } from 'zod';

import {
  tpeBasePayload, taggedAs, dispatch, dispatchOutput,
  templateEnvKeyFor, resolveTransactionId,
  pickByLocale, resolveLocale, inAppSkipUnlessEnabled,
} from '../../lib';

const SMS_TEMPLATE_ID = process.env[templateEnvKeyFor('PH-14', 'sms')] ?? '';
const WHATSAPP_TEMPLATE_NAME =
  process.env[templateEnvKeyFor('PH-14', 'whatsapp')] ?? 'dynamictemp2';

export const phLoanDisbursement = workflow(
  'ph-14-loan-disbursement',
  async ({ step, payload, subscriber }) => {
    const wfId = 'ph-14-loan-disbursement';
    const triggerId = 'PH-14';
    const audienceGroup = 'PH' as const;
    const txn = resolveTransactionId(payload);
    const locale = resolveLocale({ forceLocale: payload.forceLocale, subscriber });

    await step.inApp('inbox-loan-disbursed', async () => ({
      subject: pickByLocale(locale, {
        en: 'Loan disbursed',
        hi: 'ऋण वितरित किया गया',
      }),
      body: pickByLocale(locale, {
        en: `${payload.amount ?? 'Your loan amount'} has been disbursed ` +
            `to your bank account ending ${payload.bankLast4 ?? '****'}. ` +
            `Reference: ${payload.utrNumber ?? '(pending)'}`,
        hi: `${payload.amount ?? 'आपकी ऋण राशि'} आपके बैंक खाते में ` +
            `(अंतिम 4 अंक ${payload.bankLast4 ?? '****'}) वितरित कर दी गई है।`,
      }),
    }), { skip: inAppSkipUnlessEnabled });

    await step.custom('sms-loan-disbursed', async () => dispatchOutput(
      await dispatch({
        channel: 'sms', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'sms', sms: {
          templateId: SMS_TEMPLATE_ID,
          vars: {
            var1: payload.amount ?? '',
            amount: payload.amount ?? '',
            bankLast4: payload.bankLast4 ?? '',
            utr: payload.utrNumber ?? '',
          },
        }},
      })));

    await step.custom('whatsapp-loan-disbursed', async () => dispatchOutput(
      await dispatch({
        channel: 'whatsapp', triggerId, audienceGroup, workflowId: wfId,
        transactionId: txn, subscriber, payload,
        content: { channel: 'whatsapp', whatsapp: {
          templateName: WHATSAPP_TEMPLATE_NAME,
          languageCode: locale,
          buttonUrlParam: payload.loanId ?? payload.ph_id ?? 'loan',
          opaqueCallback: `ph-14:${payload.loanId ?? 'no-id'}`,
        }},
      })));
  },
  {
    payloadSchema: tpeBasePayload.extend({
      amount: z.string().optional(),
      bankLast4: z.string().optional(),
      utrNumber: z.string().optional(),
      loanId: z.string().optional(),
      ph_id: z.string().optional(),
    }),
    tags: taggedAs('PH', 'PH-14', 'transactional', 'loan', 'disbursement'),
  },
);
