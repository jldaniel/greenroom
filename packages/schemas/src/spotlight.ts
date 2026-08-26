import * as z from "zod";

import { idSchema, relativePathSchema, timestampSchema } from "./primitives";
import { profileIdSchema } from "./profiles";
import { reviewDisplayIdSchema, revisionIdSchema } from "./reviews";
import { threadAnchorListSchema } from "./threads";

export const spotlightViewIdSchema = idSchema.refine(
  (value) => value.startsWith("spotlight_view_"),
  {
    message: "Spotlight view IDs must use the spotlight_view_ prefix",
  },
);

export const spotlightViewRegionIdSchema = idSchema.refine(
  (value) => value.startsWith("spotlight_region_"),
  {
    message: "Spotlight region IDs must use the spotlight_region_ prefix",
  },
);

export const spotlightRunIdSchema = idSchema.refine((value) => value.startsWith("spotlight_run_"), {
  message: "Spotlight run IDs must use the spotlight_run_ prefix",
});

export const spotlightViewRefSchema = z
  .string()
  .trim()
  .regex(/^SV-[1-9]\d*$/u, "Spotlight view refs must look like SV-3");

/**
 * The only externally-accepted way to address a Spotlight view. Kept as a
 * named alias of the display-ref schema so API surfaces read as "reference".
 */
export const spotlightViewReferenceSchema = spotlightViewRefSchema;

export const spotlightViewHealthSchema = z.enum(["current", "drifted", "outdated"]);

export const spotlightRunTypeSchema = z.enum(["generate", "update", "regenerate", "refine_view"]);

export const spotlightRunTriggerSchema = z.enum(["manual", "auto"]);

export const spotlightRunStatusSchema = z.enum([
  "pending_consent",
  "queued",
  "planning",
  "awaiting_plan_approval",
  "generating",
  "updating",
  "completed",
  "failed",
]);

export const spotlightIntentSchema = z.string().trim().min(1).max(80);

export const spotlightViewOutlineItemSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    intent: spotlightIntentSchema,
    description: z.string().trim().min(1).max(1000),
  })
  .strict();

export const spotlightApprovedOutlineSchema = z.array(spotlightViewOutlineItemSchema).max(40);

export const spotlightViewCreateInputSchema = z
  .object({
    reviewDisplayId: reviewDisplayIdSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(8000),
    intent: spotlightIntentSchema,
    orderIndex: z.number().int().min(0),
    health: spotlightViewHealthSchema.default("current"),
    originRunId: spotlightRunIdSchema,
    lastReconciledRevisionId: revisionIdSchema,
  })
  .strict();

export const spotlightViewHealthUpdateInputSchema = z
  .object({
    health: spotlightViewHealthSchema,
    lastReconciledRevisionId: revisionIdSchema.optional(),
  })
  .strict();

export const spotlightViewSchema = z.object({
  reviewDisplayId: reviewDisplayIdSchema,
  displayRef: spotlightViewRefSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(8000),
  intent: spotlightIntentSchema,
  orderIndex: z.number().int().min(0),
  health: spotlightViewHealthSchema,
  originRunId: spotlightRunIdSchema,
  lastReconciledRevisionId: revisionIdSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const spotlightViewRegionCreateInputSchema = z
  .object({
    viewRef: spotlightViewRefSchema,
    filePath: relativePathSchema,
    oldPath: relativePathSchema.nullable(),
    anchors: threadAnchorListSchema,
    remapConfidence: z.number().min(0).max(1).nullable().default(null),
    stale: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    value.anchors.forEach((anchor, index) => {
      if (anchor.filePath !== value.filePath) {
        context.addIssue({
          code: "custom",
          message: "Region anchors must target the same filePath as the region",
          path: ["anchors", index, "filePath"],
        });
      }

      if (anchor.oldFilePath !== value.oldPath) {
        context.addIssue({
          code: "custom",
          message: "Region anchors must target the same oldPath as the region",
          path: ["anchors", index, "oldFilePath"],
        });
      }
    });
  });

export const spotlightViewRegionSchema = z.object({
  id: spotlightViewRegionIdSchema,
  viewRef: spotlightViewRefSchema,
  filePath: relativePathSchema,
  oldPath: relativePathSchema.nullable(),
  anchors: threadAnchorListSchema,
  remapConfidence: z.number().min(0).max(1).nullable(),
  stale: z.boolean(),
});

export const spotlightViewWithRegionsSchema = spotlightViewSchema.extend({
  regions: z.array(spotlightViewRegionSchema),
});

export const spotlightRunCreateInputSchema = z
  .object({
    reviewDisplayId: reviewDisplayIdSchema,
    type: spotlightRunTypeSchema,
    trigger: spotlightRunTriggerSchema,
    gated: z.boolean(),
    status: spotlightRunStatusSchema.default("pending_consent"),
    revisionId: revisionIdSchema,
    profileId: profileIdSchema,
    approvedOutline: spotlightApprovedOutlineSchema.nullable().default(null),
    errorMessage: z.string().trim().min(1).max(4000).nullable().default(null),
  })
  .strict();

export const spotlightRunUpdateInputSchema = z
  .object({
    status: spotlightRunStatusSchema.optional(),
    approvedOutline: spotlightApprovedOutlineSchema.nullable().optional(),
    errorMessage: z.string().trim().min(1).max(4000).nullable().optional(),
    completedAt: timestampSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one run field is required");

export const spotlightRunSchema = z.object({
  id: spotlightRunIdSchema,
  reviewDisplayId: reviewDisplayIdSchema,
  type: spotlightRunTypeSchema,
  trigger: spotlightRunTriggerSchema,
  gated: z.boolean(),
  status: spotlightRunStatusSchema,
  revisionId: revisionIdSchema,
  profileId: profileIdSchema,
  approvedOutline: spotlightApprovedOutlineSchema.nullable(),
  errorMessage: z.string().trim().min(1).max(4000).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});

export type SpotlightViewId = z.infer<typeof spotlightViewIdSchema>;
export type SpotlightViewRef = z.infer<typeof spotlightViewRefSchema>;
export type SpotlightViewReference = z.infer<typeof spotlightViewReferenceSchema>;
export type SpotlightViewRegionId = z.infer<typeof spotlightViewRegionIdSchema>;
export type SpotlightRunId = z.infer<typeof spotlightRunIdSchema>;
export type SpotlightViewHealth = z.infer<typeof spotlightViewHealthSchema>;
export type SpotlightRunType = z.infer<typeof spotlightRunTypeSchema>;
export type SpotlightRunTrigger = z.infer<typeof spotlightRunTriggerSchema>;
export type SpotlightRunStatus = z.infer<typeof spotlightRunStatusSchema>;
export type SpotlightIntent = z.infer<typeof spotlightIntentSchema>;
export type SpotlightViewOutlineItem = z.infer<typeof spotlightViewOutlineItemSchema>;
export type SpotlightApprovedOutline = z.infer<typeof spotlightApprovedOutlineSchema>;
export type SpotlightViewCreateInput = z.input<typeof spotlightViewCreateInputSchema>;
export type SpotlightViewHealthUpdateInput = z.input<typeof spotlightViewHealthUpdateInputSchema>;
export type SpotlightView = z.infer<typeof spotlightViewSchema>;
export type SpotlightViewRegionCreateInput = z.input<typeof spotlightViewRegionCreateInputSchema>;
export type SpotlightViewRegion = z.infer<typeof spotlightViewRegionSchema>;
export type SpotlightViewWithRegions = z.infer<typeof spotlightViewWithRegionsSchema>;
export type SpotlightRunCreateInput = z.input<typeof spotlightRunCreateInputSchema>;
export type SpotlightRunUpdateInput = z.input<typeof spotlightRunUpdateInputSchema>;
export type SpotlightRun = z.infer<typeof spotlightRunSchema>;
