import * as z from "zod";

import { idSchema, timestampSchema } from "./primitives";
import { repositorySchema } from "./repositories";
import { reviewDisplayIdSchema, reviewPrSchema, revisionSnapshotSchema } from "./reviews";
import { threadRefSchema, threadAnchorSchema, threadSchema, commentSchema } from "./threads";

export const profileIdSchema = idSchema.refine((value) => value.startsWith("profile_"), {
  message: "Profile IDs must use the profile_ prefix",
});

export const tokenIdSchema = idSchema.refine((value) => value.startsWith("token_"), {
  message: "Token IDs must use the token_ prefix",
});

export const agentEventIdSchema = idSchema.refine((value) => value.startsWith("event_"), {
  message: "Agent event IDs must use the event_ prefix",
});

export const profileWorkflowTypeSchema = z.enum([
  "teaching",
  "spotlight",
  "review",
  "handoff",
  "builtin_review",
]);

export const providerKindSchema = z.enum(["custom", "mock", "harness"]);

// One-click consent (default) combines context preview and run approval in a
// single confirmation. Two-step keeps the strict create-then-approve flow.
// Trusted mode skips the pre-run confirmation entirely and,
// for the built-in review workflow, auto-creates threads from validated
// findings. Trusted mode reduces clicks, not records: the consent summary and
// approved scope are recorded exactly as in one-click mode.
export const profileConsentModeSchema = z.enum(["one_click", "two_step", "trusted"]);

export const profilePrivacySchema = z.object({
  // Redacted harness transcripts are persisted by default;
  // profiles opt out by setting persistTranscript to false.
  persistTranscript: z.boolean().default(true),
  consentMode: profileConsentModeSchema.default("one_click"),
});

export const profileCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  workflowType: profileWorkflowTypeSchema,
  provider: providerKindSchema,
  model: z.string().trim().min(1).max(160),
  // Human-readable note shown wherever profiles are listed. Seeding uses it
  // to explain why a profile exists (e.g. mock fallback when no harness CLI
  // was detected at first startup).
  description: z.string().max(2000).nullable().optional(),
  systemPrompt: z.string().max(65_000).nullable().optional(),
  modelSettings: z.record(z.string(), z.unknown()).default({}),
  allowedTools: z.array(z.string().trim().min(1).max(160)).default([]),
  contextPreferences: z.record(z.string(), z.unknown()).default({}),
  privacy: profilePrivacySchema.default({
    persistTranscript: true,
    consentMode: "one_click",
  }),
});

export const profileUpdateInputSchema = profileCreateInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one profile field is required");

export const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().trim().min(1).max(160),
  workflowType: profileWorkflowTypeSchema,
  provider: providerKindSchema,
  model: z.string().trim().min(1).max(160),
  description: z.string().max(2000).nullable().default(null),
  systemPrompt: z.string().max(65_000).nullable(),
  modelSettings: z.record(z.string(), z.unknown()),
  allowedTools: z.array(z.string().trim().min(1).max(160)),
  contextPreferences: z.record(z.string(), z.unknown()),
  privacy: profilePrivacySchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const capabilityScopeSchema = z.enum([
  "read",
  "comment:write",
  "thread:resolve",
  "review:write",
  "admin",
]);

export const capabilityScopesSchema = z
  .array(capabilityScopeSchema)
  .min(1)
  .superRefine((scopes, context) => {
    if (new Set(scopes).size === scopes.length) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "Capability scopes must be unique",
    });
  });

export const capabilityTokenCreateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    scopes: capabilityScopesSchema,
    /**
     * Optional hard expiry. Expired tokens fail authentication exactly like
     * revoked tokens. Run-scoped workflow MCP grants always set this from the
     * run's timeout budget so no grant can outlive its run.
     */
    expiresAt: timestampSchema.nullable().optional(),
  })
  .strict();

export const capabilityTokenSchema = z.object({
  id: tokenIdSchema,
  name: z.string().trim().min(1).max(160),
  tokenHash: z.string().trim().min(1).max(512),
  scopes: capabilityScopesSchema,
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable().default(null),
});

export const capabilityTokenPublicSchema = capabilityTokenSchema.omit({ tokenHash: true });

export const capabilityTokenCreatedResponseSchema = z.object({
  token: capabilityTokenPublicSchema,
  plaintextToken: z.string().trim().min(1),
});

export const handoffRequestSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  threadRefs: z.array(threadRefSchema).min(1),
  desiredOutcome: z.string().trim().min(1).max(4000).nullable().optional(),
});

export const handoffThreadSchema = z.object({
  thread: threadSchema,
  anchor: threadAnchorSchema,
  anchors: z.array(threadAnchorSchema).min(1),
  comments: z.array(commentSchema),
  snippets: z.array(z.string()),
});

export const handoffBundleSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  review: reviewPrSchema,
  repository: repositorySchema,
  currentRevision: revisionSnapshotSchema.nullable(),
  selectedThreadRefs: z.array(threadRefSchema),
  desiredOutcome: z.string().nullable(),
  threads: z.array(handoffThreadSchema),
  createdAt: timestampSchema,
});

export const agentEventTypeSchema = z.enum(["attempted_fix", "status_update", "note"]);

export const agentEventSourceSchema = z.object({
  kind: z.enum(["mcp_client", "external_agent", "human", "system"]),
  displayName: z.string().trim().min(1).max(160),
  clientName: z.string().trim().min(1).max(160).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const agentEventCreateInputSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema.nullable().optional(),
  eventType: agentEventTypeSchema,
  source: agentEventSourceSchema,
  threadRefs: z.array(threadRefSchema).default([]),
  summary: z.string().trim().min(1).max(65_000),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const storedThreadRefSchema = z
  .string()
  .trim()
  .regex(/^GT-[1-9]\d*$/u, "Stored thread refs must look like GT-12");

export const agentEventSchema = z.object({
  id: agentEventIdSchema,
  reviewDisplayId: reviewDisplayIdSchema.nullable(),
  eventType: agentEventTypeSchema,
  source: agentEventSourceSchema,
  threadRefs: z.array(storedThreadRefSchema),
  summary: z.string().trim().min(1).max(65_000),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});

export type ProfileId = z.infer<typeof profileIdSchema>;
export type TokenId = z.infer<typeof tokenIdSchema>;
export type AgentEventId = z.infer<typeof agentEventIdSchema>;
export type ProfileWorkflowType = z.infer<typeof profileWorkflowTypeSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type ProfileConsentMode = z.infer<typeof profileConsentModeSchema>;
export type ProfilePrivacy = z.infer<typeof profilePrivacySchema>;
export type ProfileCreateInput = z.input<typeof profileCreateInputSchema>;
export type ProfileUpdateInput = z.input<typeof profileUpdateInputSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>;
export type CapabilityTokenCreateInput = z.input<typeof capabilityTokenCreateInputSchema>;
export type CapabilityToken = z.infer<typeof capabilityTokenSchema>;
export type CapabilityTokenPublic = z.infer<typeof capabilityTokenPublicSchema>;
export type CapabilityTokenCreatedResponse = z.infer<typeof capabilityTokenCreatedResponseSchema>;
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export type HandoffThread = z.infer<typeof handoffThreadSchema>;
export type HandoffBundle = z.infer<typeof handoffBundleSchema>;
export type AgentEventType = z.infer<typeof agentEventTypeSchema>;
export type AgentEventSource = z.infer<typeof agentEventSourceSchema>;
export type AgentEventCreateInput = z.input<typeof agentEventCreateInputSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
