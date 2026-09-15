import type { RateLimitRule } from "@/lib/rate-limit";

/**
 * Rate limits for the extension's AI Check estimates (2b text, 2c images).
 * Every check is a paid model call from a public, unauthenticated extension,
 * so each kind has its own per-IP limits, and both share one global daily
 * budget that caps total spend even if many IPs are used together. See
 * CLAUDE.md (2026-09-15, AI Check 2b and 2c).
 */
const HOUR = 3600;
const DAY = 24 * HOUR;

type Rule = RateLimitRule & { perClient?: boolean; message: string; status?: number };

/** Checks per day across all clients and both kinds; AI_CHECK_DAILY_CAP overrides. */
export function globalDailyCap(env: Record<string, string | undefined> = process.env): number {
  const cap = Number.parseInt(env.AI_CHECK_DAILY_CAP ?? "", 10);
  return Number.isFinite(cap) && cap >= 0 ? cap : 1000;
}

function globalBudget(env: Record<string, string | undefined>): Rule {
  return {
    name: "ai-check-all",
    perClient: false,
    limit: globalDailyCap(env),
    windowSeconds: DAY,
    status: 503,
    message: "TrustTab has reached today's capacity for AI checks. Please try again tomorrow.",
  };
}

export function aiTextRateLimits(env: Record<string, string | undefined> = process.env): Rule[] {
  return [
    { name: "ai-text-hour", limit: 10, windowSeconds: HOUR, message: "Hourly limit for writing checks reached." },
    { name: "ai-text-day", limit: 30, windowSeconds: DAY, message: "Daily limit for writing checks reached." },
    globalBudget(env),
  ];
}

export function aiImageRateLimits(env: Record<string, string | undefined> = process.env): Rule[] {
  return [
    { name: "ai-image-hour", limit: 10, windowSeconds: HOUR, message: "Hourly limit for image estimates reached." },
    { name: "ai-image-day", limit: 30, windowSeconds: DAY, message: "Daily limit for image estimates reached." },
    globalBudget(env),
  ];
}
