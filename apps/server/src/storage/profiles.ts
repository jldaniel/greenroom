import { asc, eq, ne } from "drizzle-orm";

import {
  createProfile,
  DomainInvariantError,
  nowTimestamp,
  type DomainFactoryOptions,
} from "@greenroom/core";
import {
  createHarnessProfileDefaultInput,
  getHarnessKindDescriptor,
  profileCreateInputSchema,
  profileSchema,
  profileUpdateInputSchema,
  type Profile,
  type ProfileCreateInput,
  type ProfileId,
  type ProfileUpdateInput,
} from "@greenroom/schemas";

import { profiles } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";

type ProfileRow = typeof profiles.$inferSelect;
type ProfileInsert = typeof profiles.$inferInsert;

/**
 * Explicit fresh-DB seed override: `mock` or `harness:<kind>` (for
 * example `harness:claude-code`). When no override is configured, seeding is
 * driven by harness detection instead — see `seedProfilesFromDetection` in
 * `../api/services.ts`.
 */
export type ProfileDefaultAiBackend = "mock" | `harness:${string}`;

export interface ProfilePersistenceOptions extends DomainFactoryOptions {
  defaultAiBackend?: ProfileDefaultAiBackend;
}

export interface ProfilePersistenceService {
  /**
   * Seeds the default profiles for the configured `defaultAiBackend`
   * override. A no-op (returns `[]`) when no override is configured; the
   * detection-driven seeding path in the API layer is responsible for fresh
   * databases in that case.
   */
  ensureDefaults: () => Profile[];
  /** Inserts the given profile inputs whose names are not taken yet. */
  seedProfiles: (inputs: readonly ProfileCreateInput[]) => Profile[];
  list: () => Profile[];
  get: (id: ProfileId) => Profile | null;
  create: (input: ProfileCreateInput) => Profile;
  update: (id: ProfileId, input: ProfileUpdateInput) => Profile | null;
  delete: (id: ProfileId) => Profile | null;
}

export function createProfilePersistenceService(
  db: GreenroomDrizzleDatabase,
  options: ProfilePersistenceOptions = {},
): ProfilePersistenceService {
  function seedProfiles(inputs: readonly ProfileCreateInput[]): Profile[] {
    const created: Profile[] = [];

    for (const input of inputs) {
      const existing = db.select().from(profiles).where(eq(profiles.name, input.name)).get();

      if (existing !== undefined) {
        continue;
      }

      const profile = createProfile(input, options);
      db.insert(profiles).values(profileToInsert(profile)).run();
      created.push(profile);
    }

    return created;
  }

  function ensureDefaults(): Profile[] {
    const backend = options.defaultAiBackend;

    if (backend === undefined) {
      return [];
    }

    return seedProfiles(defaultProfileInputsForBackend(backend));
  }

  return {
    ensureDefaults,
    seedProfiles,

    list() {
      ensureDefaults();
      return db.select().from(profiles).orderBy(asc(profiles.name)).all().map(parseProfile);
    },

    get(id) {
      ensureDefaults();
      const row = db.select().from(profiles).where(eq(profiles.id, id)).get();
      return row === undefined ? null : parseProfile(row);
    },

    create(input) {
      ensureDefaults();
      const parsed = profileCreateInputSchema.parse(input);
      assertUniqueName(db, parsed.name);
      const profile = createProfile(parsed, options);
      db.insert(profiles).values(profileToInsert(profile)).run();
      return profile;
    },

    update(id, input) {
      ensureDefaults();
      const row = db.select().from(profiles).where(eq(profiles.id, id)).get();

      if (row === undefined) {
        return null;
      }

      const parsed = profileUpdateInputSchema.parse(input);

      if (parsed.name !== undefined) {
        assertUniqueName(db, parsed.name, id);
      }

      const updated = profileSchema.parse({
        ...parseProfile(row),
        ...parsed,
        description:
          parsed.description === undefined ? row.description : (parsed.description ?? null),
        systemPrompt:
          parsed.systemPrompt === undefined ? row.systemPrompt : (parsed.systemPrompt ?? null),
        modelSettings:
          parsed.modelSettings === undefined ? row.modelSettings : parsed.modelSettings,
        allowedTools: parsed.allowedTools === undefined ? row.allowedTools : parsed.allowedTools,
        contextPreferences:
          parsed.contextPreferences === undefined
            ? row.contextPreferences
            : parsed.contextPreferences,
        privacy: parsed.privacy === undefined ? row.privacy : parsed.privacy,
        updatedAt: options.clock?.() ?? nowTimestamp(),
      });

      db.update(profiles).set(profileToInsert(updated)).where(eq(profiles.id, id)).run();
      return updated;
    },

    delete(id) {
      ensureDefaults();
      const row = db.select().from(profiles).where(eq(profiles.id, id)).get();

      if (row === undefined) {
        return null;
      }

      db.delete(profiles).where(eq(profiles.id, id)).run();
      return parseProfile(row);
    },
  };
}

export function parseProfile(row: ProfileRow): Profile {
  return profileSchema.parse({
    id: row.id,
    name: row.name,
    workflowType: row.workflowType,
    provider: row.provider,
    model: row.model,
    description: row.description,
    systemPrompt: row.systemPrompt,
    modelSettings: row.modelSettings,
    allowedTools: row.allowedTools,
    contextPreferences: row.contextPreferences,
    privacy: row.privacy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

const defaultTeachingSystemPrompt =
  "Explain code review diffs as a patient senior engineer. Focus on what changed, why it matters, and how to reason about the design.";
const defaultSpotlightSystemPrompt =
  "Group a review PR diff into intent-coherent Spotlight views with concise narratives, suggested reading order, and line-anchored changed regions.";
const defaultBuiltinReviewSystemPrompt =
  "Review the approved Greenroom diff, report only actionable changed-line findings, and avoid duplicating existing open threads.";
const defaultTeachingContextPreferences = {
  includeDiffHunks: true,
  includeQuiz: true,
};
const defaultSpotlightContextPreferences = {
  includeDiffHunks: true,
  autoGenerate: false,
  manualRunsGated: true,
  updateRunsGated: true,
};
const defaultPrivacy = {
  persistTranscript: true,
};

/**
 * Marker stored in `contextPreferences` on mock profiles seeded because no
 * harness CLI was detected. Startup seeding treats a database that contains
 * only fallback-marked profiles as still eligible for harness seeding, so a
 * later restart (or the first-run wizard) upgrades to harness profiles once a
 * CLI is detected.
 */
export const mockFallbackSeedMarker = "detection_fallback";

export const mockFallbackProfileDescription =
  "Mock AI profile seeded automatically: no coding-agent harness CLI was detected when Greenroom " +
  "first started (no supported CLI installed, or the harness bridge was unreachable). Mock runs " +
  "return canned output. To use a real AI backend, install a supported harness CLI (for example " +
  "Claude Code) and restart Greenroom with `greenroom up`; harness-backed profiles are then " +
  "seeded automatically.";

export interface DefaultProfileInputOptions {
  description?: string | null;
  seedMarker?: string;
}

/** Default mock Teaching and Spotlight profile inputs. */
export function defaultMockProfileInputs(
  options: DefaultProfileInputOptions = {},
): ProfileCreateInput[] {
  const contextMarker = options.seedMarker === undefined ? {} : { seededBy: options.seedMarker };

  return [
    {
      name: "Default teaching",
      workflowType: "teaching",
      provider: "mock",
      model: "mock-teacher",
      description: options.description ?? null,
      systemPrompt: defaultTeachingSystemPrompt,
      modelSettings: {},
      allowedTools: [],
      contextPreferences: { ...defaultTeachingContextPreferences, ...contextMarker },
      privacy: defaultPrivacy,
    },
    {
      name: "Default spotlight",
      workflowType: "spotlight",
      provider: "mock",
      model: "mock-spotlight",
      description: options.description ?? null,
      systemPrompt: defaultSpotlightSystemPrompt,
      modelSettings: {},
      allowedTools: [],
      contextPreferences: { ...defaultSpotlightContextPreferences, ...contextMarker },
      privacy: defaultPrivacy,
    },
  ];
}

/**
 * Default harness-backed Teaching, Spotlight, and built-in AI review profile
 * inputs for one harness kind. Works generically for any kind reported by
 * detection: known kinds pick up their descriptor label and default model,
 * unknown kinds fall back to the kind string, so newly supported harnesses
 * seed without code changes here.
 *
 * Known kinds only get inputs for the workflows their descriptor declares in
 * `supportedWorkflows`; a detected kind with no supported workflows (Codex
 * today) yields no inputs, so seeding never creates profiles whose runs the
 * bridge would reject. Unknown kinds keep the full set.
 */
export function defaultHarnessProfileInputs(
  kind: string,
  options: { label?: string; description?: string | null } = {},
): ProfileCreateInput[] {
  const descriptor = getHarnessKindDescriptor(kind);
  const label = options.label ?? descriptor?.label ?? kind;
  const description = options.description ?? null;

  const inputs = [
    createHarnessProfileDefaultInput({
      name: `Default teaching (${label})`,
      workflowType: "teaching",
      kind,
      description,
      systemPrompt: defaultTeachingSystemPrompt,
      contextPreferences: defaultTeachingContextPreferences,
    }),
    createHarnessProfileDefaultInput({
      name: `Default spotlight (${label})`,
      workflowType: "spotlight",
      kind,
      description,
      systemPrompt: defaultSpotlightSystemPrompt,
      contextPreferences: defaultSpotlightContextPreferences,
    }),
    createHarnessProfileDefaultInput({
      name: `Default AI review (${label})`,
      workflowType: "builtin_review",
      kind,
      description,
      systemPrompt: defaultBuiltinReviewSystemPrompt,
    }),
  ];

  if (descriptor === null) {
    return inputs;
  }

  return inputs.filter((input) => descriptor.supportedWorkflows.includes(input.workflowType));
}

function defaultProfileInputsForBackend(backend: ProfileDefaultAiBackend): ProfileCreateInput[] {
  if (backend === "mock") {
    return defaultMockProfileInputs();
  }

  const kind = backend.slice("harness:".length);
  return defaultHarnessProfileInputs(kind, {
    description: `Seeded from the configured default AI backend override (${backend}).`,
  });
}

function assertUniqueName(db: GreenroomDrizzleDatabase, name: string, exceptId?: ProfileId): void {
  const row =
    exceptId === undefined
      ? db.select().from(profiles).where(eq(profiles.name, name)).get()
      : db
          .select()
          .from(profiles)
          .where(ne(profiles.id, exceptId))
          .all()
          .find((candidate) => candidate.name === name);

  if (row !== undefined) {
    throw new DomainInvariantError(`Profile name ${name} is already in use`);
  }
}

function profileToInsert(profile: Profile): ProfileInsert {
  return { ...profile };
}
