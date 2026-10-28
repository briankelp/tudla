import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "./config.js";
import { AppError } from "./security.js";
export type Identity = { id: string; email: string };
export type VerifyToken = (token: string) => Promise<Identity>;
export function tokenVerifier(c: Config): VerifyToken {
  const jwks = c.supabaseUrl
    ? createRemoteJWKSet(
        new URL(`${c.supabaseUrl}/auth/v1/.well-known/jwks.json`),
      )
    : null;
  return async (token) => {
    if (!jwks)
      throw new AppError(503, "Sign-in is unavailable on this deployment.");
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: `${c.supabaseUrl}/auth/v1`,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
      });
      if (
        typeof payload.sub !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          payload.sub,
        ) ||
        typeof payload.email !== "string" ||
        payload.role !== "authenticated" ||
        payload.is_anonymous === true ||
        !(
          payload.app_metadata as { providers?: string[] } | undefined
        )?.providers?.includes("google")
      )
        throw Error("Invalid identity");
      return { id: payload.sub, email: payload.email.toLowerCase() };
    } catch {
      throw new AppError(401, "Your session expired. Sign in again.");
    }
  };
}
