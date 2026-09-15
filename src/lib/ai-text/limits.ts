import type { RateLimitRule } from "@/lib/rate-limit";

/**
 * Rate limits for the AI-written text estimate. Every check is a paid model
 * call from a public, unauthenticated extension, so limits are per client IP
 * plus one global daily budget that caps total spend even if many IPs are
 * used together. See CLAUDE.md (2026-09-15, AI Check 2b).
 */
const HOUR = 3600;
const DAY = 24 * HOUR;

export function aiTextRateLimits(env: Record<string, string | undefined> = process.env) {
  const cap = Number.parseInt(env.AI_TEXT_DAILY_CAP ?? "", 10);
  const dailyCap = Number.isFinite(cap) && cap >= 0 ? cap : 1000;
  return [
    { name: "ai-text-hour", limit: 10, windowSeconds: HOUR, message: "Hourly limit for writing checks reached." },
    { name: "ai-text-day", limit: 30, windowSeconds: DAY, message: "Daily limit for writing checks reached." },
    {
      name: "ai-text-all",
      perClient: false,
      limit: dailyCap,
      windowSeconds: DAY,
      status: 503,
      message: "TrustTab has reached today's capacity for writing checks. Please try again tomorrow.",
    },
  ] satisfies (RateLimitRule & { perClient?: boolean; message: string; status?: number })[];
}
