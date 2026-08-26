import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { DomainFactoryOptions } from "@greenroom/core";

import { openGreenroomDatabase, type GreenroomDatabase } from "../storage/database";
import { createAgentEventPersistenceService } from "../storage/agent-events";
import {
  createProfilePersistenceService,
  type ProfilePersistenceOptions,
} from "../storage/profiles";
import { createRepositoryPersistenceService } from "../storage/repositories";
import { createReviewPersistenceService } from "../storage/reviews";
import { createSpotlightPersistenceService } from "../storage/spotlight";
import { createThreadPersistenceService } from "../storage/threads";
import { createTokenPersistenceService } from "../storage/tokens";
import { createWorkflowPersistenceService } from "../storage/workflows";

export interface TestStorage {
  directory: string;
  databasePath: string;
  database: GreenroomDatabase;
  repositories: ReturnType<typeof createRepositoryPersistenceService>;
  reviews: ReturnType<typeof createReviewPersistenceService>;
  threads: ReturnType<typeof createThreadPersistenceService>;
  tokens: ReturnType<typeof createTokenPersistenceService>;
  profiles: ReturnType<typeof createProfilePersistenceService>;
  spotlight: ReturnType<typeof createSpotlightPersistenceService>;
  agentEvents: ReturnType<typeof createAgentEventPersistenceService>;
  workflows: ReturnType<typeof createWorkflowPersistenceService>;
  cleanup: () => void;
}

export function createTestStorage(
  options: DomainFactoryOptions & ProfilePersistenceOptions = {},
): TestStorage {
  const directory = mkdtempSync(join(tmpdir(), "greenroom-storage-"));
  const databasePath = join(directory, "greenroom.sqlite");
  const database = openGreenroomDatabase({ databasePath });

  return {
    directory,
    databasePath,
    database,
    repositories: createRepositoryPersistenceService(database.db, options),
    reviews: createReviewPersistenceService(database.db, options),
    threads: createThreadPersistenceService(database.db, options),
    tokens: createTokenPersistenceService(database.db, options),
    profiles: createProfilePersistenceService(database.db, options),
    spotlight: createSpotlightPersistenceService(database.db, options),
    agentEvents: createAgentEventPersistenceService(database.db, options),
    workflows: createWorkflowPersistenceService(database.db, {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
    cleanup: () => {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
