import "server-only";
import * as client from "openid-client";
import { recordDenyAuditSafely } from "./audit";
import { getRuntimeConfig } from "./config";
import { createSafeSubjectRef } from "./crypto";
import { getRuntimePool, type Queryable } from "./db";
import {
  consumeAuthTransaction,
  createAuthTransaction,
  establishSessionFromVerifiedOidcIdentity,
  type EstablishSessionResult,
} from "./session";

let cachedOidcConfig: client.Configuration | null = null;
let cachedOidcKey: string | null = null;

export function clearOidcConfigCache(): void {
  cachedOidcConfig = null;
  cachedOidcKey = null;
}

/**
 * Discovers OIDC server metadata from the server-configured allowlisted issuer only.
 * Enables non-repudiation JWS signature verification and allows loopback HTTP only in DEVTEST (dev/test).
 */
export async function getOidcClientConfiguration(
  customFetchImpl?: client.CustomFetch,
): Promise<client.Configuration> {
  const cfg = getRuntimeConfig();
  const cacheKey = `${cfg.oidcIssuer}|${cfg.oidcClientId}|${cfg.oidcClientSecret}`;

  if (!customFetchImpl && cachedOidcConfig && cachedOidcKey === cacheKey) {
    return cachedOidcConfig;
  }

  const executeHooks: Array<(c: client.Configuration) => void> = [
    client.enableNonRepudiationChecks,
  ];
  if (
    (cfg.appEnv === "dev" || cfg.appEnv === "test") &&
    cfg.oidcIssuer.startsWith("http://127.0.0.1:")
  ) {
    executeHooks.push(client.allowInsecureRequests);
  }

  const discoveryOptions: client.DiscoveryRequestOptions = {
    execute: executeHooks,
    timeout: 15,
  };
  if (customFetchImpl) {
    discoveryOptions[client.customFetch] = customFetchImpl;
  }

  const discovered = await client.discovery(
    new URL(cfg.oidcIssuer),
    cfg.oidcClientId,
    cfg.oidcClientSecret,
    client.ClientSecretPost(cfg.oidcClientSecret),
    discoveryOptions,
  );

  // Verify discovered issuer matches configured allowlist issuer exactly
  const serverMeta = discovered.serverMetadata();
  if (serverMeta.issuer !== cfg.oidcIssuer) {
    throw new Error(
      `[OIDC_ISSUER_MISMATCH] Discovered issuer "${serverMeta.issuer}" does not match configured allowlist issuer "${cfg.oidcIssuer}".`,
    );
  }

  if (!customFetchImpl) {
    cachedOidcConfig = discovered;
    cachedOidcKey = cacheKey;
  }
  return discovered;
}

export interface StartOidcLoginResult {
  authorizationUrl: string;
  rawTxCookieToken: string;
  expiresAt: Date;
}

/**
 * Initiates an OIDC Authorization Code + PKCE S256 + state + nonce transaction.
 * Rejects any attempt to override issuer or post-login returnTo outside `/workspace`.
 */
export async function initiateOidcLoginTransaction(params?: {
  requestedIssuer?: string | null;
  requestedReturnTo?: string | null;
  now?: Date;
  db?: Queryable;
  oidcConfig?: client.Configuration;
}): Promise<
  | { ok: true; data: StartOidcLoginResult }
  | { ok: false; httpStatus: 400; reasonCode: string }
> {
  const cfg = getRuntimeConfig();
  const db = params?.db ?? getRuntimePool();
  const now = params?.now ?? new Date();

  if (params?.requestedIssuer) {
    await recordDenyAuditSafely(db, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.start",
      resourceType: "auth_transaction",
      resourceId: "rejected",
      scopeContext: { reason: "CLIENT_ISSUER_OVERRIDE_FORBIDDEN" },
      reasonCode: "CLIENT_ISSUER_OVERRIDE_FORBIDDEN",
    });
    return {
      ok: false,
      httpStatus: 400,
      reasonCode: "CLIENT_ISSUER_OVERRIDE_FORBIDDEN",
    };
  }

  if (
    params?.requestedReturnTo !== undefined &&
    params?.requestedReturnTo !== null &&
    params.requestedReturnTo !== "" &&
    params.requestedReturnTo !== "/workspace"
  ) {
    await recordDenyAuditSafely(db, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.start",
      resourceType: "auth_transaction",
      resourceId: "rejected",
      scopeContext: { reason: "RETURN_DESTINATION_NOT_ALLOWED" },
      reasonCode: "RETURN_DESTINATION_NOT_ALLOWED",
    });
    return {
      ok: false,
      httpStatus: 400,
      reasonCode: "RETURN_DESTINATION_NOT_ALLOWED",
    };
  }

  const oidcConfig = params?.oidcConfig ?? (await getOidcClientConfiguration());

  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();

  const { rawTxCookieToken, expiresAt } = await createAuthTransaction({
    state,
    nonce,
    codeVerifier,
    now,
    db,
  });

  const redirectTo = client.buildAuthorizationUrl(oidcConfig, {
    redirect_uri: cfg.oidcRedirectUri,
    scope: "openid profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });

  return {
    ok: true,
    data: {
      authorizationUrl: redirectTo.toString(),
      rawTxCookieToken,
      expiresAt,
    },
  };
}

export type CompleteOidcCallbackResult =
  | {
      decision: "ALLOW";
      session: Extract<EstablishSessionResult, { decision: "ALLOW" }>;
      redirectPath: "/workspace";
    }
  | {
      decision: "DENY";
      httpStatus: 400 | 401 | 403 | 500;
      reasonCode: string;
    };

/**
 * Completes the OIDC callback:
 * 1. Rejects any client-supplied issuer or redirect overrides in query string.
 * 2. Atomically consumes the one-use AuthTransaction (state + 5m TTL + AES-256-GCM PKCE verifier).
 * 3. Exchanges code via openid-client authorizationCodeGrant with PKCE verifier, expectedState, expectedNonce, and idTokenExpected.
 * 4. Verifies issuer and subject claims from the validated ID token.
 * 5. Evaluates Staff/RoleAssignment policy and atomically issues Session + ALLOW AuditEvent.
 */
export async function completeOidcCallback(params: {
  callbackUrl: URL;
  rawTxCookieToken: string | undefined;
  now?: Date;
  oidcConfig?: client.Configuration;
}): Promise<CompleteOidcCallbackResult> {
  const cfg = getRuntimeConfig();
  const pool = getRuntimePool();
  const now = params.now ?? new Date();

  const searchParams = params.callbackUrl.searchParams;

  // Reject any attempt to inject redirect_uri, returnTo, or custom untrusted iss in callback
  const injectedRedirect =
    searchParams.get("redirect_uri") ??
    searchParams.get("returnTo") ??
    searchParams.get("next") ??
    searchParams.get("post_login_redirect");
  if (injectedRedirect) {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: "callback",
      scopeContext: { reason: "CALLBACK_REDIRECT_INJECTION_FORBIDDEN" },
      reasonCode: "CALLBACK_REDIRECT_INJECTION_FORBIDDEN",
    });
    return {
      decision: "DENY",
      httpStatus: 400,
      reasonCode: "CALLBACK_REDIRECT_INJECTION_FORBIDDEN",
    };
  }

  const issParam = searchParams.get("iss");
  if (issParam !== null && issParam !== cfg.oidcIssuer) {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: "callback",
      scopeContext: { reason: "CALLBACK_ISSUER_MISMATCH" },
      reasonCode: "CALLBACK_ISSUER_MISMATCH",
    });
    return {
      decision: "DENY",
      httpStatus: 400,
      reasonCode: "CALLBACK_ISSUER_MISMATCH",
    };
  }

  const returnedState = searchParams.get("state") ?? undefined;
  const txResult = await consumeAuthTransaction({
    rawTxCookieToken: params.rawTxCookieToken,
    returnedState,
    now,
    db: pool,
  });

  if (!txResult.ok) {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: "callback",
      scopeContext: { reason: txResult.reasonCode },
      reasonCode: txResult.reasonCode,
    });
    return {
      decision: "DENY",
      httpStatus: 400,
      reasonCode: txResult.reasonCode,
    };
  }

  // Ensure the callback URL passed to openid-client uses the fixed allowlisted callback origin/path
  const canonicalCallbackUrl = new URL(cfg.oidcRedirectUri);
  canonicalCallbackUrl.search = params.callbackUrl.search;

  let oidcConfig: client.Configuration;
  try {
    oidcConfig = params.oidcConfig ?? (await getOidcClientConfiguration());
  } catch {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: txResult.txId,
      scopeContext: { reason: "OIDC_DISCOVERY_FAILED" },
      reasonCode: "OIDC_DISCOVERY_FAILED",
    });
    return {
      decision: "DENY",
      httpStatus: 401,
      reasonCode: "OIDC_DISCOVERY_FAILED",
    };
  }

  let tokenResponse: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokenResponse = await client.authorizationCodeGrant(
      oidcConfig,
      canonicalCallbackUrl,
      {
        pkceCodeVerifier: txResult.codeVerifier,
        expectedState: txResult.state,
        expectedNonce: txResult.nonce,
        idTokenExpected: true,
      },
    );
  } catch {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: txResult.txId,
      scopeContext: { reason: "OIDC_TOKEN_VALIDATION_FAILED" },
      reasonCode: "OIDC_TOKEN_VALIDATION_FAILED",
    });
    return {
      decision: "DENY",
      httpStatus: 401,
      reasonCode: "OIDC_TOKEN_VALIDATION_FAILED",
    };
  }

  const claims = tokenResponse.claims();
  if (
    !claims ||
    typeof claims.iss !== "string" ||
    typeof claims.sub !== "string" ||
    claims.sub.trim().length === 0
  ) {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: "anonymous",
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: txResult.txId,
      scopeContext: { reason: "OIDC_ID_TOKEN_CLAIMS_MISSING" },
      reasonCode: "OIDC_ID_TOKEN_CLAIMS_MISSING",
    });
    return {
      decision: "DENY",
      httpStatus: 401,
      reasonCode: "OIDC_ID_TOKEN_CLAIMS_MISSING",
    };
  }

  if (claims.iss !== cfg.oidcIssuer) {
    await recordDenyAuditSafely(pool, {
      occurredAt: now,
      actorStaffId: null,
      actorSubjectRef: createSafeSubjectRef(claims.iss, claims.sub),
      action: "auth.login.callback",
      resourceType: "auth_transaction",
      resourceId: txResult.txId,
      scopeContext: { reason: "OIDC_CLAIM_ISSUER_NOT_ALLOWLISTED" },
      reasonCode: "OIDC_CLAIM_ISSUER_NOT_ALLOWLISTED",
    });
    return {
      decision: "DENY",
      httpStatus: 401,
      reasonCode: "OIDC_CLAIM_ISSUER_NOT_ALLOWLISTED",
    };
  }

  const sessionResult = await establishSessionFromVerifiedOidcIdentity({
    issuer: claims.iss,
    subject: claims.sub,
    now,
    pool,
  });

  if (sessionResult.decision === "DENY") {
    return {
      decision: "DENY",
      httpStatus: sessionResult.httpStatus,
      reasonCode: sessionResult.reasonCode,
    };
  }

  return {
    decision: "ALLOW",
    session: sessionResult,
    redirectPath: "/workspace",
  };
}
