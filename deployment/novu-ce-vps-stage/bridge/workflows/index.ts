/**
 * Workflow registry — every TPE Novu workflow gets imported here and
 * appended to the `workflows` array. The Bridge framework's `serve()`
 * discovers everything in this list at request time.
 *
 * Conventions:
 *   - Group by audience subdirectory: policyholder/, investor/, partner/,
 *     operations/, regulatory/.
 *   - Filename = `<trigger-id-lowercase>-<short-name>.ts`.
 *   - See ./AUTHORING.md for the workflow file template + acceptance checklist.
 *
 * As of Phase 0, only the placeholder `welcomeOnboarding` is exported. The
 * 49 real workflows land starting with PH-02 in Phase 1.
 */

import { welcomeOnboarding } from './welcome-onboarding-minimal';
import { tpeMultichannelTest } from './_test/tpe-multichannel-test';
import { phRegistration } from './policyholder/ph-02-registration';
import { phInvestorMatched } from './policyholder/ph-09-investor-matched';
import { phLoanApproval } from './policyholder/ph-13-loan-approval';
import { phLoanDisbursement } from './policyholder/ph-14-loan-disbursement';
import { phLoanEmiReminder } from './policyholder/ph-15-loan-emi-reminder';
import { phLoanClosure } from './policyholder/ph-16-loan-closure';
import { phReEngagement } from './policyholder/ph-17-re-engagement';
import { phAssignmentPaperwork } from './policyholder/ph-08-assignment-paperwork';
import { phPostAssignmentWelcome } from './policyholder/ph-11-post-assignment-welcome';
import { phLoanApplication } from './policyholder/ph-12-loan-application';
import { invRegistration } from './investor/inv-02-registration';
import { invInvestmentSoftCommit } from './investor/inv-05-investment-soft-commit';
import { invInvestmentConfirmed } from './investor/inv-07-investment-confirmed';
import { invPremiumDue } from './investor/inv-08-premium-due';
import { invPremiumPaymentConfirmation } from './investor/inv-09-premium-payment-confirmation';
import { invMaturityReminder } from './investor/inv-11-maturity-reminder';
import { invMaturityReceived } from './investor/inv-12-maturity-received';

// Group A — Policyholder Lifecycle (18) — see ./policyholder/README.md
//   PH-01 Lead Captured           — TBD
//   PH-02 Registration            — TBD (recommended exemplar)
//   PH-03 KYC                     — TBD
//   PH-04 Policy Document Upload  — TBD
//   PH-05 Policy Verification     — TBD
//   PH-06 Surrender Value Quote   — TBD
//   PH-07 Offer Decision          — TBD
//   PH-08 Assignment Paperwork    — TBD
//   PH-09 Investor Matched        — TBD
//   PH-10 Disbursement            — TBD
//   PH-11 Post-Assignment Welcome — TBD
//   PH-12 Loan Application        — TBD
//   PH-13 Loan Approval           — TBD
//   PH-14 Loan Disbursement       — TBD
//   PH-15 Loan EMI Reminder       — TBD
//   PH-16 Loan Closure            — TBD
//   PH-17 Re-engagement           — TBD
//   PH-18 Referral Program        — TBD

// Group B — Investor Lifecycle (16) — see ./investor/README.md
//   INV-01..16, with INV-08 Premium Due as the volume flagship.

// Group C — Insurance Partner / B2B (6) — see ./partner/README.md
//   INS-01..06, all multi-tenant (require resolveInsurer()).

// Group D — Internal Operations (6) — see ./operations/README.md
//   OPS-01..06, internal Slack/Teams/Email only.

// Group E — Regulatory / Statutory (3) — see ./regulatory/README.md
//   REG-01..03, statutory templates with Compliance Lead sign-off.

export const workflows = [
  welcomeOnboarding,
  tpeMultichannelTest,
  // Group A — Policyholder Lifecycle
  phRegistration,                  // PH-02
  phAssignmentPaperwork,           // PH-08
  phInvestorMatched,               // PH-09
  phPostAssignmentWelcome,         // PH-11
  phLoanApplication,               // PH-12
  phLoanApproval,                  // PH-13
  phLoanDisbursement,              // PH-14
  phLoanEmiReminder,               // PH-15 (multi-stage loan EMI cadence)
  phLoanClosure,                   // PH-16 (final-state loan closure)
  phReEngagement,                  // PH-17 (dormant policyholder check-in)
  // Group B — Investor Lifecycle
  invRegistration,                 // INV-02
  invInvestmentSoftCommit,         // INV-05
  invInvestmentConfirmed,          // INV-07
  invPremiumDue,                   // INV-08 (volume flagship — multi-stage cadence)
  invPremiumPaymentConfirmation,   // INV-09
  invMaturityReminder,             // INV-11 (multi-stage maturity cadence)
  invMaturityReceived,             // INV-12
  // ↑ as workflows land in policyholder/ / investor/ / partner/ / operations/
  // / regulatory/, import them here and append.
];
