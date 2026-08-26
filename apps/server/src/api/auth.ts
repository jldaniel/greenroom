import type { Context } from "hono";

import type { CapabilityScope } from "@greenroom/schemas";

import type { AuthenticatedCapabilityToken } from "../storage/tokens";
import { ApiHttpError } from "./errors";
import type { GreenroomApiServices } from "./services";

export interface GreenroomAuthEnv {
  Variables: {
    greenroomToken: AuthenticatedCapabilityToken;
  };
}

export async function requireBearerAuth(
  context: Context<GreenroomAuthEnv>,
  services: GreenroomApiServices,
): Promise<void> {
  const plaintextToken = parseBearerToken(context.req.header("authorization"));
  const token = services.tokens.authenticate(plaintextToken);

  if (token === null) {
    throw new ApiHttpError(401, "unauthorized", "Bearer token is invalid or revoked");
  }

  context.set("greenroomToken", token);
}

export function requireScope(context: Context<GreenroomAuthEnv>, scope: CapabilityScope): void {
  const token = context.get("greenroomToken");

  if (!hasScope(token, scope)) {
    throw new ApiHttpError(403, "forbidden", `Token requires the ${scope} scope`);
  }
}

export function hasScope(token: AuthenticatedCapabilityToken, scope: CapabilityScope): boolean {
  return token.scopes.includes("admin") || token.scopes.includes(scope);
}

function parseBearerToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined || authorizationHeader.trim().length === 0) {
    throw new ApiHttpError(401, "unauthorized", "Bearer token is required");
  }

  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/u);

  if (scheme?.toLowerCase() !== "bearer" || token === undefined || extra !== undefined) {
    throw new ApiHttpError(401, "unauthorized", "Authorization header must use Bearer token");
  }

  return token;
}
