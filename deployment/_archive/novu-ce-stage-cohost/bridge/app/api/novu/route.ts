import { serve } from '@novu/framework/next';
import { workflows } from '../../../workflows';

// Exposes Novu Bridge endpoint at /api/novu
// Methods: GET (health/discovery), POST (execute), OPTIONS (CORS)
export const { GET, POST, OPTIONS } = serve({
  workflows,
  // Optional: explicit secret key for HMAC verification.
  // If unset, falls back to NOVU_SECRET_KEY env var.
  // secretKey: process.env.NOVU_SECRET_KEY,
});
