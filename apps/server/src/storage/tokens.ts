import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { createCapabilityToken, nowTimestamp, type DomainFactoryOptions } from "@greenroom/core";
import {
  capabilityTokenCreateInputSchema,
  capabilityTokenPublicSchema,
  capabilityTokenSchema,
  type CapabilityScope,
  type CapabilityToken,
  type CapabilityTokenCreateInput,
  type CapabilityTokenPublic,
  type TokenId,
} from "@greenroom/schemas";

import { capabilityTokens } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

type CapabilityTokenRow = typeof capabilityTokens.$inferSelect;
type CapabilityTokenInsert = typeof capabilityTokens.$inferInsert;

export interface CreatedCapabilityToken {
  token: CapabilityTokenPublic;
  plaintextToken: string;
}

export interface AuthenticatedCapabilityToken extends CapabilityTokenPublic {
  scopes: CapabilityScope[];
}

export interface TokenPersistenceService {
  create: (input: CapabilityTokenCreateInput) => CreatedCapabilityToken;
  provision: (plaintextToken: string, input: CapabilityTokenCreateInput) => CapabilityTokenPublic;
  list: () => CapabilityTokenPublic[];
  authenticate: (plaintextToken: string) => AuthenticatedCapabilityToken | null;
  revoke: (id: TokenId) => CapabilityTokenPublic | null;
  /**
   * Marks every unrevoked token whose `expiresAt` has passed as revoked and
   * returns how many tokens were swept. Expiry is also enforced lazily at
   * authentication time; this sweep keeps listings and active counts honest.
   */
  revokeExpired: () => number;
  activeCount: () => number;
}

export const minimumProvisionedTokenLength = 24;

export function createTokenPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: DomainFactoryOptions = {},
): TokenPersistenceService {
  return {
    create(input) {
      const parsed = capabilityTokenCreateInputSchema.parse(input);
      const plaintextToken = generatePlaintextToken();
      const token: CapabilityToken = {
        ...createCapabilityToken(
          {
            ...parsed,
            tokenHash: hashCapabilityToken(plaintextToken),
          },
          options,
        ),
        expiresAt: parsed.expiresAt ?? null,
      };

      db.insert(capabilityTokens).values(tokenToInsert(token)).run();

      return {
        token: toPublicToken(token),
        plaintextToken,
      };
    },

    provision(plaintextToken, input) {
      if (plaintextToken.length < minimumProvisionedTokenLength) {
        throw new Error(
          `Pre-provisioned tokens must be at least ${minimumProvisionedTokenLength} characters`,
        );
      }

      const tokenHash = hashCapabilityToken(plaintextToken);
      const existing = db
        .select()
        .from(capabilityTokens)
        .where(eq(capabilityTokens.tokenHash, tokenHash))
        .get();

      if (existing !== undefined) {
        const token = parseToken(existing);

        if (token.revokedAt !== null) {
          throw new Error(
            "Pre-provisioned token matches a revoked token; choose a new token value",
          );
        }

        return toPublicToken(token);
      }

      const parsed = capabilityTokenCreateInputSchema.parse(input);
      const token: CapabilityToken = {
        ...createCapabilityToken({ ...parsed, tokenHash }, options),
        expiresAt: parsed.expiresAt ?? null,
      };

      db.insert(capabilityTokens).values(tokenToInsert(token)).run();

      return toPublicToken(token);
    },

    list() {
      return db
        .select()
        .from(capabilityTokens)
        .orderBy(desc(capabilityTokens.createdAt))
        .all()
        .map(parseToken)
        .map(toPublicToken);
    },

    authenticate(plaintextToken) {
      const tokenHash = hashCapabilityToken(plaintextToken);
      const row = db
        .select()
        .from(capabilityTokens)
        .where(eq(capabilityTokens.tokenHash, tokenHash))
        .get();

      if (row === undefined) {
        return null;
      }

      const token = parseToken(row);

      if (token.revokedAt !== null) {
        return null;
      }

      const now = options.clock?.() ?? nowTimestamp();

      if (isTokenExpired(token, now)) {
        // Lazy sweep: an expired token is dead credential material, so stamp
        // it revoked on first use attempt to keep listings and counts honest.
        db.update(capabilityTokens)
          .set({ revokedAt: now })
          .where(eq(capabilityTokens.id, token.id))
          .run();
        return null;
      }

      const lastUsedAt = now;
      db.update(capabilityTokens)
        .set({ lastUsedAt })
        .where(eq(capabilityTokens.id, token.id))
        .run();

      return toPublicToken({
        ...token,
        lastUsedAt,
      });
    },

    revoke(id) {
      const row = db.select().from(capabilityTokens).where(eq(capabilityTokens.id, id)).get();

      if (row === undefined) {
        return null;
      }

      const revokedAt = row.revokedAt ?? options.clock?.() ?? nowTimestamp();

      if (row.revokedAt === null) {
        db.update(capabilityTokens).set({ revokedAt }).where(eq(capabilityTokens.id, id)).run();
      }

      return toPublicToken(
        parseToken({
          ...row,
          revokedAt,
        }),
      );
    },

    revokeExpired() {
      const now = options.clock?.() ?? nowTimestamp();
      const candidates = db
        .select()
        .from(capabilityTokens)
        .where(and(isNull(capabilityTokens.revokedAt), isNotNull(capabilityTokens.expiresAt)))
        .all()
        .map(parseToken)
        .filter((token) => isTokenExpired(token, now));

      for (const token of candidates) {
        db.update(capabilityTokens)
          .set({ revokedAt: now })
          .where(eq(capabilityTokens.id, token.id))
          .run();
      }

      return candidates.length;
    },

    activeCount() {
      return db.select().from(capabilityTokens).where(isNull(capabilityTokens.revokedAt)).all()
        .length;
    },
  };
}

export function generatePlaintextToken(): string {
  return `grt_${randomBytes(32).toString("base64url")}`;
}

export function hashCapabilityToken(plaintextToken: string): string {
  return `sha256:${createHash("sha256").update(plaintextToken, "utf8").digest("base64url")}`;
}

function isTokenExpired(token: CapabilityToken, now: string): boolean {
  return token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.parse(now);
}

function parseToken(row: CapabilityTokenRow): CapabilityToken {
  return capabilityTokenSchema.parse({
    id: row.id,
    name: row.name,
    tokenHash: row.tokenHash,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    expiresAt: row.expiresAt,
  });
}

function toPublicToken(token: CapabilityToken): CapabilityTokenPublic {
  return capabilityTokenPublicSchema.parse({
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt,
    expiresAt: token.expiresAt,
  });
}

function tokenToInsert(token: CapabilityToken): CapabilityTokenInsert {
  return { ...token };
}
