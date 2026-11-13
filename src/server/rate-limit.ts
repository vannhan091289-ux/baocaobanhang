import "server-only";

export const AUTH_START_RATE_LIMIT_MAX_REQUESTS = 30;
export const AUTH_START_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

interface BucketEntry {
  windowStartMs: number;
  count: number;
}

const ipBuckets = new Map<string, BucketEntry>();

/**
 * Extracts a direct peer IP identifier without trusting arbitrary X-Forwarded-For headers
 * (per docs/decisions/SPRINT-1-APPROVAL.md §2).
 */
export function resolveDirectClientIp(request: Request): string {
  // S1-A is bound to loopback. Request headers are never a trusted peer source,
  // including in APP_ENV=test, which is also the real local/CI application profile.
  void request;
  return "127.0.0.1";
}

export function checkAuthStartRateLimit(
  directIp: string,
  nowMs: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const key = directIp || "127.0.0.1";
  const existing = ipBuckets.get(key);

  if (
    !existing ||
    nowMs - existing.windowStartMs >= AUTH_START_RATE_LIMIT_WINDOW_MS
  ) {
    ipBuckets.set(key, { windowStartMs: nowMs, count: 1 });
    return {
      allowed: true,
      remaining: AUTH_START_RATE_LIMIT_MAX_REQUESTS - 1,
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= AUTH_START_RATE_LIMIT_MAX_REQUESTS) {
    const elapsedMs = nowMs - existing.windowStartMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((AUTH_START_RATE_LIMIT_WINDOW_MS - elapsedMs) / 1000),
    );
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: AUTH_START_RATE_LIMIT_MAX_REQUESTS - existing.count,
    retryAfterSeconds: 0,
  };
}

export function resetAuthStartRateLimitBuckets(): void {
  ipBuckets.clear();
}
