import { asc, desc, eq } from "drizzle-orm";

import {
  createSpotlightRun,
  createSpotlightView,
  createSpotlightViewRegion,
  nowTimestamp,
  type DomainFactoryOptions,
  type StoredSpotlightView,
} from "@greenroom/core";
import {
  spotlightRunCreateInputSchema,
  spotlightRunSchema,
  spotlightRunUpdateInputSchema,
  spotlightViewHealthUpdateInputSchema,
  spotlightViewRegionSchema,
  spotlightViewSchema,
  spotlightViewWithRegionsSchema,
  type ReviewPrId,
  type SpotlightRun,
  type SpotlightRunCreateInput,
  type SpotlightRunId,
  type SpotlightRunUpdateInput,
  type SpotlightView,
  type SpotlightViewCreateInput,
  type SpotlightViewHealthUpdateInput,
  type SpotlightViewId,
  type SpotlightViewReference,
  type SpotlightViewRegion,
  type SpotlightViewRegionCreateInput,
  type SpotlightViewWithRegions,
} from "@greenroom/schemas";

import { reviewPrs, spotlightRuns, spotlightViewRegions, spotlightViews } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";
import { allocateDisplayNumber } from "./ref-counters";

type SpotlightRunRow = typeof spotlightRuns.$inferSelect;
type SpotlightViewRow = typeof spotlightViews.$inferSelect;
type SpotlightViewRegionRow = typeof spotlightViewRegions.$inferSelect;
type SpotlightRunInsert = typeof spotlightRuns.$inferInsert;
type SpotlightViewInsert = typeof spotlightViews.$inferInsert;
type SpotlightViewRegionInsert = typeof spotlightViewRegions.$inferInsert;

export type CreateSpotlightRegionForViewInput = Omit<SpotlightViewRegionCreateInput, "viewRef">;

export type CreateSpotlightViewForReviewInput = Omit<
  SpotlightViewCreateInput,
  "reviewDisplayId"
> & {
  regions?: CreateSpotlightRegionForViewInput[];
};

export type UpdateSpotlightViewInput = Partial<
  Pick<
    SpotlightView,
    "title" | "description" | "intent" | "orderIndex" | "health" | "lastReconciledRevisionId"
  >
>;

export interface SpotlightPersistenceService {
  createRun: (input: SpotlightRunCreateInput) => SpotlightRun;
  listRunsByReview: (reviewId: ReviewPrId) => SpotlightRun[];
  getRun: (id: SpotlightRunId) => SpotlightRun | null;
  updateRun: (id: SpotlightRunId, input: SpotlightRunUpdateInput) => SpotlightRun | null;
  deleteRun: (id: SpotlightRunId) => SpotlightRun | null;
  createView: (input: SpotlightViewCreateInput) => SpotlightView;
  listViewsByReview: (reviewId: ReviewPrId) => SpotlightView[];
  listViewsWithRegionsByReview: (reviewId: ReviewPrId) => SpotlightViewWithRegions[];
  getViewByRef: (ref: SpotlightViewReference) => SpotlightView | null;
  getViewWithRegionsByRef: (ref: SpotlightViewReference) => SpotlightViewWithRegions | null;
  updateViewHealth: (
    ref: SpotlightViewReference,
    input: SpotlightViewHealthUpdateInput,
  ) => SpotlightView | null;
  updateView: (
    ref: SpotlightViewReference,
    input: UpdateSpotlightViewInput,
  ) => SpotlightView | null;
  listRegionsByView: (ref: SpotlightViewReference) => SpotlightViewRegion[];
  replaceRegions: (
    ref: SpotlightViewReference,
    regions: CreateSpotlightRegionForViewInput[],
  ) => SpotlightViewRegion[] | null;
  deleteViewsByReview: (reviewId: ReviewPrId) => SpotlightView[];
  replaceViewsForReview: (
    reviewId: ReviewPrId,
    views: CreateSpotlightViewForReviewInput[],
  ) => SpotlightViewWithRegions[];
}

export function createSpotlightPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: DomainFactoryOptions = {},
): SpotlightPersistenceService {
  return {
    createRun(input) {
      const parsed = spotlightRunCreateInputSchema.parse(input);
      const reviewRow = db
        .select({ id: reviewPrs.id })
        .from(reviewPrs)
        .where(eq(reviewPrs.displayId, parsed.reviewDisplayId))
        .get();

      if (reviewRow === undefined) {
        throw new Error(`Review ${parsed.reviewDisplayId} was not found`);
      }

      const run = createSpotlightRun(parsed, options);
      db.insert(spotlightRuns).values(runToInsert(run, reviewRow.id)).run();
      return run;
    },

    listRunsByReview(reviewId) {
      return db
        .select({ run: spotlightRuns, reviewDisplayId: reviewPrs.displayId })
        .from(spotlightRuns)
        .innerJoin(reviewPrs, eq(spotlightRuns.reviewId, reviewPrs.id))
        .where(eq(spotlightRuns.reviewId, reviewId))
        .orderBy(desc(spotlightRuns.createdAt))
        .all()
        .map((row) => parseSpotlightRun(row.run, row.reviewDisplayId));
    },

    getRun(id) {
      const row = selectRunWithDisplayId(db, id);
      return row === undefined ? null : parseSpotlightRun(row.run, row.reviewDisplayId);
    },

    updateRun(id, input) {
      const row = selectRunWithDisplayId(db, id);

      if (row === undefined) {
        return null;
      }

      const parsed = spotlightRunUpdateInputSchema.parse(input);
      const current = parseSpotlightRun(row.run, row.reviewDisplayId);
      const updated = spotlightRunSchema.parse({
        ...current,
        ...parsed,
        approvedOutline:
          parsed.approvedOutline === undefined ? current.approvedOutline : parsed.approvedOutline,
        errorMessage:
          parsed.errorMessage === undefined ? current.errorMessage : parsed.errorMessage,
        completedAt: parsed.completedAt === undefined ? current.completedAt : parsed.completedAt,
        updatedAt: options.clock?.() ?? nowTimestamp(),
      });

      db.update(spotlightRuns)
        .set(runToInsert(updated, row.run.reviewId))
        .where(eq(spotlightRuns.id, id))
        .run();
      return updated;
    },

    deleteRun(id) {
      const row = selectRunWithDisplayId(db, id);

      if (row === undefined) {
        return null;
      }

      db.delete(spotlightRuns).where(eq(spotlightRuns.id, id)).run();
      return parseSpotlightRun(row.run, row.reviewDisplayId);
    },

    createView(input) {
      return db.transaction((transaction) => {
        const { id: _id, ...view } = insertView(transaction, input, options);
        return view;
      });
    },

    listViewsByReview(reviewId) {
      return listViewRowsByReview(db, reviewId).map((row) =>
        parseSpotlightView(row.view, row.reviewDisplayId),
      );
    },

    listViewsWithRegionsByReview(reviewId) {
      return listViewRowsByReview(db, reviewId).map((row) =>
        viewWithRegions(
          parseSpotlightView(row.view, row.reviewDisplayId),
          listRegionsByView(db, row.view.id, row.view.displayRef),
        ),
      );
    },

    getViewByRef(ref) {
      const row = selectViewWithDisplayId(db, ref);
      return row === undefined ? null : parseSpotlightView(row.view, row.reviewDisplayId);
    },

    getViewWithRegionsByRef(ref) {
      const row = selectViewWithDisplayId(db, ref);
      return row === undefined
        ? null
        : viewWithRegions(
            parseSpotlightView(row.view, row.reviewDisplayId),
            listRegionsByView(db, row.view.id, row.view.displayRef),
          );
    },

    updateViewHealth(ref, input) {
      const row = selectViewWithDisplayId(db, ref);

      if (row === undefined) {
        return null;
      }

      const parsed = spotlightViewHealthUpdateInputSchema.parse(input);
      const current = parseSpotlightView(row.view, row.reviewDisplayId);
      const updated = spotlightViewSchema.parse({
        ...current,
        health: parsed.health,
        lastReconciledRevisionId:
          parsed.lastReconciledRevisionId ?? current.lastReconciledRevisionId,
        updatedAt: options.clock?.() ?? nowTimestamp(),
      });

      db.update(spotlightViews)
        .set(viewToInsert({ ...updated, id: row.view.id }, row.view.reviewId))
        .where(eq(spotlightViews.id, row.view.id))
        .run();
      return updated;
    },

    updateView(ref, input) {
      const row = selectViewWithDisplayId(db, ref);

      if (row === undefined) {
        return null;
      }

      const updated = spotlightViewSchema.parse({
        ...parseSpotlightView(row.view, row.reviewDisplayId),
        ...input,
        updatedAt: options.clock?.() ?? nowTimestamp(),
      });

      db.update(spotlightViews)
        .set(viewToInsert({ ...updated, id: row.view.id }, row.view.reviewId))
        .where(eq(spotlightViews.id, row.view.id))
        .run();
      return updated;
    },

    listRegionsByView(ref) {
      const row = selectViewWithDisplayId(db, ref);
      return row === undefined ? [] : listRegionsByView(db, row.view.id, row.view.displayRef);
    },

    replaceRegions(ref, regions) {
      return db.transaction((transaction) => {
        const row = selectViewWithDisplayId(transaction, ref);

        if (row === undefined) {
          return null;
        }

        return replaceRegionsForView(
          transaction,
          row.view.id,
          row.view.displayRef,
          regions,
          options,
        );
      });
    },

    deleteViewsByReview(reviewId) {
      return db.transaction((transaction) => {
        const deleted = listViewRowsByReview(transaction, reviewId).map((row) =>
          parseSpotlightView(row.view, row.reviewDisplayId),
        );
        transaction.delete(spotlightViews).where(eq(spotlightViews.reviewId, reviewId)).run();
        return deleted;
      });
    },

    replaceViewsForReview(reviewId, views) {
      return db.transaction((transaction) => {
        const reviewRow = transaction
          .select({ displayId: reviewPrs.displayId })
          .from(reviewPrs)
          .where(eq(reviewPrs.id, reviewId))
          .get();

        if (reviewRow === undefined) {
          throw new Error(`Review ${reviewId} was not found`);
        }

        transaction.delete(spotlightViews).where(eq(spotlightViews.reviewId, reviewId)).run();

        return views.map((viewInput) => {
          const { regions: regionInputs = [], ...viewFields } = viewInput;
          const stored = insertView(
            transaction,
            { ...viewFields, reviewDisplayId: reviewRow.displayId },
            options,
          );
          const regions = replaceRegionsForView(
            transaction,
            stored.id,
            stored.displayRef,
            regionInputs,
            options,
          );
          const { id: _id, ...view } = stored;

          return viewWithRegions(view, regions);
        });
      });
    },
  };
}

function selectRunWithDisplayId(db: GreenroomDrizzleDatabase, id: SpotlightRunId) {
  return db
    .select({ run: spotlightRuns, reviewDisplayId: reviewPrs.displayId })
    .from(spotlightRuns)
    .innerJoin(reviewPrs, eq(spotlightRuns.reviewId, reviewPrs.id))
    .where(eq(spotlightRuns.id, id))
    .get();
}

function selectViewWithDisplayId(db: GreenroomDrizzleDatabase, ref: SpotlightViewReference) {
  return db
    .select({ view: spotlightViews, reviewDisplayId: reviewPrs.displayId })
    .from(spotlightViews)
    .innerJoin(reviewPrs, eq(spotlightViews.reviewId, reviewPrs.id))
    .where(eq(spotlightViews.displayRef, ref))
    .get();
}

export function parseSpotlightRun(row: SpotlightRunRow, reviewDisplayId: string): SpotlightRun {
  return spotlightRunSchema.parse({
    id: row.id,
    reviewDisplayId,
    type: row.type,
    trigger: row.trigger,
    gated: row.gated,
    status: row.status,
    revisionId: row.revisionId,
    profileId: row.profileId,
    approvedOutline: row.approvedOutline,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  });
}

export function parseSpotlightView(row: SpotlightViewRow, reviewDisplayId: string): SpotlightView {
  return spotlightViewSchema.parse({
    reviewDisplayId,
    displayRef: row.displayRef,
    title: row.title,
    description: row.description,
    intent: row.intent,
    orderIndex: row.orderIndex,
    health: row.health,
    originRunId: row.originRunId,
    lastReconciledRevisionId: row.lastReconciledRevisionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function parseSpotlightViewRegion(
  row: SpotlightViewRegionRow,
  viewRef: string,
): SpotlightViewRegion {
  return spotlightViewRegionSchema.parse({
    id: row.id,
    viewRef,
    filePath: row.filePath,
    oldPath: row.oldPath,
    anchors: row.anchors,
    remapConfidence: row.remapConfidence,
    stale: row.stale,
  });
}

function insertView(
  db: GreenroomDrizzleDatabase,
  input: SpotlightViewCreateInput,
  options: DomainFactoryOptions,
): StoredSpotlightView {
  const reviewRow = db
    .select({ id: reviewPrs.id })
    .from(reviewPrs)
    .where(eq(reviewPrs.displayId, input.reviewDisplayId))
    .get();

  if (reviewRow === undefined) {
    throw new Error(`Review ${input.reviewDisplayId} was not found`);
  }

  const view = createSpotlightView(input, {
    ...options,
    nextViewNumber: allocateDisplayNumber(db, "spotlight_view"),
  });
  db.insert(spotlightViews).values(viewToInsert(view, reviewRow.id)).run();
  return view;
}

function replaceRegionsForView(
  db: GreenroomDrizzleDatabase,
  viewId: SpotlightViewId,
  viewRef: string,
  regions: CreateSpotlightRegionForViewInput[],
  options: DomainFactoryOptions,
): SpotlightViewRegion[] {
  db.delete(spotlightViewRegions).where(eq(spotlightViewRegions.viewId, viewId)).run();

  return regions.map((regionInput) => {
    const region = createSpotlightViewRegion({ ...regionInput, viewRef }, options);
    db.insert(spotlightViewRegions).values(regionToInsert(region, viewId)).run();
    return region;
  });
}

function listViewRowsByReview(db: GreenroomDrizzleDatabase, reviewId: ReviewPrId) {
  return db
    .select({ view: spotlightViews, reviewDisplayId: reviewPrs.displayId })
    .from(spotlightViews)
    .innerJoin(reviewPrs, eq(spotlightViews.reviewId, reviewPrs.id))
    .where(eq(spotlightViews.reviewId, reviewId))
    .orderBy(asc(spotlightViews.orderIndex), asc(spotlightViews.createdAt))
    .all();
}

function listRegionsByView(
  db: GreenroomDrizzleDatabase,
  viewId: SpotlightViewId,
  viewRef: string,
): SpotlightViewRegion[] {
  return db
    .select()
    .from(spotlightViewRegions)
    .where(eq(spotlightViewRegions.viewId, viewId))
    .orderBy(asc(spotlightViewRegions.filePath), asc(spotlightViewRegions.id))
    .all()
    .map((row) => parseSpotlightViewRegion(row, viewRef));
}

function viewWithRegions(
  view: SpotlightView,
  regions: SpotlightViewRegion[],
): SpotlightViewWithRegions {
  return spotlightViewWithRegionsSchema.parse({ ...view, regions });
}

function runToInsert(run: SpotlightRun, reviewId: ReviewPrId): SpotlightRunInsert {
  const { reviewDisplayId: _reviewDisplayId, ...rest } = run;
  return { ...rest, reviewId };
}

function viewToInsert(view: StoredSpotlightView, reviewId: ReviewPrId): SpotlightViewInsert {
  const { reviewDisplayId: _reviewDisplayId, ...rest } = view;
  return { ...rest, reviewId };
}

function regionToInsert(
  region: SpotlightViewRegion,
  viewId: SpotlightViewId,
): SpotlightViewRegionInsert {
  const { viewRef: _viewRef, ...rest } = region;
  return { ...rest, viewId };
}
