import { desc, eq } from "drizzle-orm";

import { createRepository, nowTimestamp, type DomainFactoryOptions } from "@greenroom/core";
import {
  repositoryCreateInputSchema,
  repositorySchema,
  repositoryUpdateInputSchema,
  type Repository,
  type RepositoryCreateInput,
  type RepositoryId,
  type RepositoryUpdateInput,
} from "@greenroom/schemas";

import { repositories } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

type RepositoryRow = typeof repositories.$inferSelect;
type RepositoryInsert = typeof repositories.$inferInsert;

export interface RepositoryPersistenceService {
  create: (input: RepositoryCreateInput) => Repository;
  list: () => Repository[];
  get: (id: RepositoryId) => Repository | null;
  update: (id: RepositoryId, input: RepositoryUpdateInput) => Repository | null;
  findByIdentity: (identityKey: string) => Repository | null;
}

export function createRepositoryPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: DomainFactoryOptions = {},
): RepositoryPersistenceService {
  return {
    create(input) {
      const parsed = repositoryCreateInputSchema.parse(input);
      const identityKey = parsed.identityKey ?? parsed.gitCommonDir ?? `${parsed.rootPath}/.git`;
      const existing = db
        .select()
        .from(repositories)
        .where(eq(repositories.identityKey, identityKey))
        .get();

      if (existing !== undefined) {
        return parseRepository(existing);
      }

      const repository = createRepository({ ...parsed, identityKey }, options);
      db.insert(repositories).values(repositoryToInsert(repository)).run();
      return repository;
    },

    list() {
      return db
        .select()
        .from(repositories)
        .orderBy(desc(repositories.updatedAt))
        .all()
        .map(parseRepository);
    },

    get(id) {
      const row = db.select().from(repositories).where(eq(repositories.id, id)).get();
      return row === undefined ? null : parseRepository(row);
    },

    update(id, input) {
      const parsed = repositoryUpdateInputSchema.parse(input);
      const updatedAt = options.clock?.() ?? nowTimestamp();
      const values: Partial<RepositoryInsert> = { updatedAt };

      if (parsed.displayName !== undefined) {
        values.displayName = parsed.displayName;
      }

      if (parsed.defaultBranchCandidate !== undefined) {
        values.defaultBranchCandidate = parsed.defaultBranchCandidate;
      }

      if (parsed.lastOpenedAt !== undefined) {
        values.lastOpenedAt = parsed.lastOpenedAt;
      }

      if (parsed.spotlightConfig !== undefined) {
        values.spotlightConfig = parsed.spotlightConfig;
      }

      db.update(repositories).set(values).where(eq(repositories.id, id)).run();
      const row = db.select().from(repositories).where(eq(repositories.id, id)).get();
      return row === undefined ? null : parseRepository(row);
    },

    findByIdentity(identityKey) {
      const row = db
        .select()
        .from(repositories)
        .where(eq(repositories.identityKey, identityKey))
        .get();

      return row === undefined ? null : parseRepository(row);
    },
  };
}

export function parseRepository(row: RepositoryRow): Repository {
  return repositorySchema.parse({
    id: row.id,
    rootPath: row.rootPath,
    gitCommonDir: row.gitCommonDir,
    identityKey: row.identityKey,
    displayName: row.displayName,
    defaultBranchCandidate: row.defaultBranchCandidate,
    spotlightConfig: row.spotlightConfig ?? {},
    lastOpenedAt: row.lastOpenedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function repositoryToInsert(repository: Repository): RepositoryInsert {
  return {
    id: repository.id,
    rootPath: repository.rootPath,
    gitCommonDir: repository.gitCommonDir,
    identityKey: repository.identityKey,
    displayName: repository.displayName,
    defaultBranchCandidate: repository.defaultBranchCandidate,
    spotlightConfig: repository.spotlightConfig,
    lastOpenedAt: repository.lastOpenedAt,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
}
