import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client. With no baseURL it talks to /api/auth on the
 * current origin, which is what we want for every deployment (local, preview,
 * production, self-hosted).
 */
export const authClient = createAuthClient();
