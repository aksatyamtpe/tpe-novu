/**
 * Multi-tenant insurer registry (Charter §4.7).
 *
 * The 11 TPE insurance partners are modelled as distinct tenants of the
 * communication system. Each has a sender identity per channel, an MIS
 * attachment template (for INS-02 Premium Remittance), an escalation
 * contact, brand-voice constraints, and a DPA reference.
 *
 * Operations Lead owns the source data (Charter §2.1, §4.13). This module
 * exposes the type + a passthrough lookup; the actual data is loaded from
 * the team's source-of-truth at runtime.
 *
 * PHASE 0: in-memory placeholder map. Real implementation pulls from
 * MongoDB / config-bucket / Operations-Lead-supplied YAML.
 */

export interface InsurerProfile {
  /** Canonical ID — used as the tenancy key in trigger payloads. */
  id: string;

  /** Human-readable name. */
  displayName: string;

  /** Per-channel sender identity. */
  senderIdentity: {
    email:    { fromEmail: string; fromName: string };
    sms:      { senderId: string; dltPrincipalEntityId: string };
    whatsapp: { bspAccountId: string; templateNamespace: string };
  };

  /** INS-02 Premium Remittance — Excel template path or URI. */
  misTemplate: string;

  /** Per-carrier escalation contact (used for INS-04 Query Resolution + OPS-03). */
  escalationContact: { name: string; email: string; phone: string };

  /** Brand-voice constraints applied by the compliance middleware. */
  brandVoice: {
    tone: 'formal' | 'neutral' | 'friendly';
    bannedWords: string[];
  };

  /** DPA contract reference (DPDPA Charter §11). */
  dpaReference: string;
}

/**
 * PHASE 0 placeholder map. Replace `INSURERS_TBD` with real entries from
 * Operations once the eleven-carrier registry is delivered (Charter §4.13
 * cross-team dependency: ~2 days insurer-operations input).
 */
export const INSURER_REGISTRY: Record<string, InsurerProfile> = {
  'INSURERS_TBD': {
    id: 'INSURERS_TBD',
    displayName: 'Pending — replace with real entry',
    senderIdentity: {
      email:    { fromEmail: 'notify@example.invalid', fromName: 'TPE Operations' },
      sms:      { senderId: 'TPEOPS', dltPrincipalEntityId: 'TBD' },
      whatsapp: { bspAccountId: 'TBD', templateNamespace: 'tbd' },
    },
    misTemplate: 'tbd/template.xlsx',
    escalationContact: { name: 'TBD', email: 'tbd@example.invalid', phone: '+910000000000' },
    brandVoice: { tone: 'formal', bannedWords: [] },
    dpaReference: 'TBD-DPA-000',
  },
};

export function resolveInsurer(insurerId: string): InsurerProfile {
  const profile = INSURER_REGISTRY[insurerId];
  if (!profile) {
    throw new Error(
      `InsurerNotFound: '${insurerId}' is not in the registry. ` +
      `See Charter §4.7 — the registry must contain the 11 partners. ` +
      `Operations Lead is the data owner.`
    );
  }
  return profile;
}

/** Used when a workflow runs without insurer context (PH-XX, INV-XX, OPS-XX). */
export const TPE_DEFAULT_SENDER = {
  customerCare:  { fromEmail: 'notify@thepolicyexchange.com',     fromName: 'TPE Customer Care' },
  investments:   { fromEmail: 'investments@thepolicyexchange.com', fromName: 'TPE Investments' },
  operations:    { fromEmail: 'operations@thepolicyexchange.com',  fromName: 'TPE Operations' },
  systemBot:     { fromEmail: 'system@thepolicyexchange.com',      fromName: 'TPE System Bot' },
  compliance:    { fromEmail: 'compliance@thepolicyexchange.com',  fromName: 'TPE Compliance' },
} as const;
