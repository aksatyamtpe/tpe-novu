/**
 * TPE Q2=E — Full CRUD origin coercion.
 *
 * The upstream Novu dashboard treats workflows with origin === EXTERNAL
 * (Bridge / code-first) as read-only:
 *   - Delete button disabled (workflow-row.tsx:510)
 *   - Most form fields disabled (configure-workflow-form.tsx:142,328)
 *   - Step editor mode toggle hidden (step-editor-layout.tsx:278)
 *   - Edges non-interactive (edges.tsx:32)
 *   - Canvas marked read-only (workflow-canvas.tsx:84)
 *   - Configure-step form disabled (configure-step-form.tsx:137)
 *   - Several digest/delay tabs disabled (digest-delay-tabs/*.tsx)
 *
 * Rather than touch all 20+ gates, we normalize `origin` at the SINGLE
 * fetch chokepoint. Every downstream component reads `origin` and resolves
 * its own gate, so the change cascades automatically.
 *
 * This is gated by `IS_FULL_CRUD_ENABLED` so it can be flipped off via
 * env var without rebuilding (just restart the container).
 *
 * Created 2026-05-02 for the Q2=E sandbox-3.15 pivot.
 */

import { ResourceOriginEnum } from '@novu/shared';
import { IS_FULL_CRUD_ENABLED } from '../config';

/**
 * Coerce a workflow's origin from EXTERNAL to INTERNAL when Full-CRUD is on.
 * Pure function, no mutation — returns a shallow-cloned workflow with the
 * `origin` field rewritten if applicable.
 *
 * Safe to call when the flag is off (returns the input unchanged).
 * Safe to call with `undefined` (returns undefined).
 */
export function coerceOriginForFullCrud<T extends { origin?: ResourceOriginEnum } | undefined>(workflow: T): T {
  if (!IS_FULL_CRUD_ENABLED) return workflow;
  if (!workflow) return workflow;
  if (workflow.origin !== ResourceOriginEnum.EXTERNAL) return workflow;
  // Coerce EXTERNAL → NOVU_CLOUD (NOT NOVU_CLOUD_V1).
  //   - NOVU_CLOUD enables: Delete, Duplicate, Sync (dev→prod), step conditions
  //     editing, payload schema editing, channel preferences. ✅ what we want.
  //   - NOVU_CLOUD_V1 triggers `isV0Workflow` which in self-hosted mode marks the
  //     entire workflow row as cursor-not-allowed (workflow-row.tsx:255). ❌
  //   - The few NOVU_CLOUD-specific Cloud UX bits (e.g. "Novu branding" toggle,
  //     onboarding checklist overlay) require a uiSchema or unsafeMetadata that
  //     Bridge workflows don't have, so they stay invisible.
  return { ...workflow, origin: ResourceOriginEnum.NOVU_CLOUD } as T;
}

/**
 * Same as `coerceOriginForFullCrud` but for the list-style response
 * `{ workflows: [...], totalCount: N }` returned by `getWorkflows()`.
 */
export function coerceWorkflowListForFullCrud<
  T extends { workflows?: Array<{ origin?: ResourceOriginEnum }> } | undefined,
>(response: T): T {
  if (!IS_FULL_CRUD_ENABLED) return response;
  if (!response || !response.workflows) return response;
  return {
    ...response,
    workflows: response.workflows.map((w) => coerceOriginForFullCrud(w)),
  } as T;
}
