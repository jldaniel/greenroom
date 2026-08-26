import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, or } from "drizzle-orm";

import {
  createRevisionSnapshot,
  createReviewPr,
  nowTimestamp,
  type DomainFactoryOptions,
  type StoredReviewPr,
} from "@greenroom/core";
import {
  diffFileSchema,
  diffHunkSchema,
  reviewDisplayIdSchema,
  reviewPrSchema,
  reviewPrUpdateInputSchema,
  revisionSnapshotSchema,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type ReviewDisplayId,
  type ReviewPrCreateInput,
  type ReviewPrId,
  type ReviewStateFilter,
  type ReviewPrUpdateInput,
  type RevisionCreateInput,
  type RevisionId,
  type RevisionSnapshot,
} from "@greenroom/schemas";

import { diffFiles, diffHunks, reviewPrs, reviewRevisions } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";
import { allocateDisplayNumber } from "./ref-counters";

type ReviewRow = typeof reviewPrs.$inferSelect;
type RevisionRow = typeof reviewRevisions.$inferSelect;
type DiffFileRow = typeof diffFiles.$inferSelect;
type DiffHunkRow = typeof diffHunks.$inferSelect;
type ReviewInsert = typeof reviewPrs.$inferInsert;
type RevisionInsert = typeof reviewRevisions.$inferInsert;
type DiffFileInsert = typeof diffFiles.$inferInsert;
type DiffHunkInsert = typeof diffHunks.$inferInsert;

export type CreateDiffHunkInput = Omit<DiffHunk, "id" | "fileId">;

export type CreateDiffFileInput = Omit<DiffFile, "id" | "revisionId" | "hunks"> & {
  hunks?: CreateDiffHunkInput[];
};

export interface CreateReviewWithRevisionInput {
  review: ReviewPrCreateInput;
  revision: Omit<RevisionCreateInput, "reviewDisplayId">;
  diffFiles?: CreateDiffFileInput[];
}

export interface CreateRevisionForReviewInput {
  reviewId: ReviewPrId;
  revision: Omit<RevisionCreateInput, "reviewDisplayId">;
  diffFiles?: CreateDiffFileInput[];
}

export interface ReviewWithRevision {
  review: StoredReviewPr;
  revision: RevisionSnapshot;
}

export interface ReviewPersistenceService {
  createWithInitialRevision: (input: CreateReviewWithRevisionInput) => ReviewWithRevision;
  createRevision: (input: CreateRevisionForReviewInput) => ReviewWithRevision | null;
  list: (state?: ReviewStateFilter) => StoredReviewPr[];
  get: (id: ReviewPrId) => StoredReviewPr | null;
  getByDisplayId: (displayId: ReviewDisplayId) => StoredReviewPr | null;
  update: (id: ReviewPrId, input: ReviewPrUpdateInput) => StoredReviewPr | null;
  listRevisions: (reviewId: ReviewPrId) => RevisionSnapshot[];
  getRevision: (id: RevisionId) => RevisionSnapshot | null;
  listDiffFiles: (revisionId: RevisionId) => DiffFile[];
  getDiffFile: (revisionId: RevisionId, path: string) => DiffFile | null;
}

export function createReviewPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: DomainFactoryOptions = {},
): ReviewPersistenceService {
  return {
    createWithInitialRevision(input) {
      return db.transaction((transaction) => {
        const review = createReviewPr(
          { ...input.review, displayId: nextReviewDisplayId(transaction) },
          options,
        );
        transaction.insert(reviewPrs).values(reviewToInsert(review)).run();

        const revision = createRevisionSnapshot(
          {
            ...input.revision,
            reviewDisplayId: review.displayId,
          },
          options,
        );

        transaction.insert(reviewRevisions).values(revisionToInsert(revision, review.id)).run();
        insertDiffFiles(transaction, revision.id, input.diffFiles ?? []);

        const updatedReview: StoredReviewPr = {
          ...reviewPrSchema.parse({
            ...review,
            currentRevisionId: revision.id,
            updatedAt: options.clock?.() ?? nowTimestamp(),
          }),
          id: review.id,
        };

        transaction
          .update(reviewPrs)
          .set({
            currentRevisionId: updatedReview.currentRevisionId,
            updatedAt: updatedReview.updatedAt,
          })
          .where(eq(reviewPrs.id, review.id))
          .run();

        return { review: updatedReview, revision };
      });
    },

    createRevision(input) {
      return db.transaction((transaction) => {
        const reviewRow = transaction
          .select()
          .from(reviewPrs)
          .where(eq(reviewPrs.id, input.reviewId))
          .get();

        if (reviewRow === undefined) {
          return null;
        }

        const revision = createRevisionSnapshot(
          {
            ...input.revision,
            reviewDisplayId: reviewRow.displayId,
          },
          options,
        );
        transaction
          .insert(reviewRevisions)
          .values(revisionToInsert(revision, input.reviewId))
          .run();
        insertDiffFiles(transaction, revision.id, input.diffFiles ?? []);

        const updatedAt = options.clock?.() ?? nowTimestamp();
        transaction
          .update(reviewPrs)
          .set({ currentRevisionId: revision.id, updatedAt })
          .where(eq(reviewPrs.id, input.reviewId))
          .run();

        return {
          review: {
            ...reviewPrSchema.parse({
              ...parseReview(reviewRow),
              currentRevisionId: revision.id,
              updatedAt,
            }),
            id: input.reviewId,
          },
          revision,
        };
      });
    },

    list(state = "open") {
      const rows =
        state === "all"
          ? db.select().from(reviewPrs).orderBy(desc(reviewPrs.updatedAt)).all()
          : db
              .select()
              .from(reviewPrs)
              .where(eq(reviewPrs.status, state))
              .orderBy(desc(reviewPrs.updatedAt))
              .all();

      return rows.map(parseReview);
    },

    get(id) {
      const row = db.select().from(reviewPrs).where(eq(reviewPrs.id, id)).get();
      return row === undefined ? null : parseReview(row);
    },

    getByDisplayId(displayId) {
      const row = db.select().from(reviewPrs).where(eq(reviewPrs.displayId, displayId)).get();
      return row === undefined ? null : parseReview(row);
    },

    update(id, input) {
      const parsed = reviewPrUpdateInputSchema.parse(input);
      const updatedAt = options.clock?.() ?? nowTimestamp();
      const values: Partial<ReviewInsert> = { updatedAt };

      if (parsed.title !== undefined) {
        values.title = parsed.title;
      }

      if (parsed.status !== undefined) {
        values.status = parsed.status;
      }

      if (parsed.currentRevisionId !== undefined) {
        values.currentRevisionId = parsed.currentRevisionId;
      }

      if (parsed.spotlightConfig !== undefined) {
        values.spotlightConfig = parsed.spotlightConfig;
      }

      db.update(reviewPrs).set(values).where(eq(reviewPrs.id, id)).run();
      const row = db.select().from(reviewPrs).where(eq(reviewPrs.id, id)).get();
      return row === undefined ? null : parseReview(row);
    },

    listRevisions(reviewId) {
      return db
        .select({ revision: reviewRevisions, reviewDisplayId: reviewPrs.displayId })
        .from(reviewRevisions)
        .innerJoin(reviewPrs, eq(reviewRevisions.reviewId, reviewPrs.id))
        .where(eq(reviewRevisions.reviewId, reviewId))
        .orderBy(desc(reviewRevisions.createdAt))
        .all()
        .map((row) => parseRevision(row.revision, row.reviewDisplayId));
    },

    getRevision(id) {
      const row = db
        .select({ revision: reviewRevisions, reviewDisplayId: reviewPrs.displayId })
        .from(reviewRevisions)
        .innerJoin(reviewPrs, eq(reviewRevisions.reviewId, reviewPrs.id))
        .where(eq(reviewRevisions.id, id))
        .get();
      return row === undefined ? null : parseRevision(row.revision, row.reviewDisplayId);
    },

    listDiffFiles(revisionId) {
      const fileRows = db
        .select()
        .from(diffFiles)
        .where(eq(diffFiles.revisionId, revisionId))
        .orderBy(asc(diffFiles.path))
        .all();

      return fileRows.map((fileRow) => {
        const hunkRows = db
          .select()
          .from(diffHunks)
          .where(eq(diffHunks.fileId, fileRow.id))
          .orderBy(asc(diffHunks.sortOrder))
          .all();

        return parseDiffFile(fileRow, hunkRows);
      });
    },

    getDiffFile(revisionId, path) {
      const fileRow = db
        .select()
        .from(diffFiles)
        .where(
          and(
            eq(diffFiles.revisionId, revisionId),
            or(eq(diffFiles.path, path), eq(diffFiles.oldPath, path)),
          ),
        )
        .get();

      if (fileRow === undefined) {
        return null;
      }

      const hunkRows = db
        .select()
        .from(diffHunks)
        .where(eq(diffHunks.fileId, fileRow.id))
        .orderBy(asc(diffHunks.sortOrder))
        .all();

      return parseDiffFile(fileRow, hunkRows);
    },
  };
}

export function parseReview(row: ReviewRow): StoredReviewPr {
  const entity = reviewPrSchema.parse({
    displayId: row.displayId,
    repositoryId: row.repositoryId,
    title: row.title,
    range: row.range,
    baseRefDisplay: row.baseRefDisplay,
    headRefDisplay: row.headRefDisplay,
    currentRevisionId: row.currentRevisionId,
    status: row.status === "archived" ? "closed" : row.status,
    spotlightConfig: row.spotlightConfig ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  return { ...entity, id: row.id };
}

export function parseRevision(row: RevisionRow, reviewDisplayId: string): RevisionSnapshot {
  return revisionSnapshotSchema.parse({
    id: row.id,
    reviewDisplayId,
    baseSha: row.baseSha,
    headSha: row.headSha,
    worktreeFingerprint: row.worktreeFingerprint,
    diffSummary: row.diffSummary,
    refreshReason: row.refreshReason,
    createdAt: row.createdAt,
  });
}

export function parseDiffFile(fileRow: DiffFileRow, hunkRows: DiffHunkRow[]): DiffFile {
  const hunks = hunkRows.map((row) =>
    diffHunkSchema.parse({
      id: row.id,
      fileId: row.fileId,
      oldStart: row.oldStart,
      oldLines: row.oldLines,
      newStart: row.newStart,
      newLines: row.newLines,
      header: row.header,
      lines: row.lines,
      sortOrder: row.sortOrder,
    }),
  );

  return diffFileSchema.parse({
    id: fileRow.id,
    revisionId: fileRow.revisionId,
    path: fileRow.path,
    oldPath: fileRow.oldPath,
    status: fileRow.status,
    isBinary: fileRow.isBinary,
    additions: fileRow.additions,
    deletions: fileRow.deletions,
    oldMode: fileRow.oldMode,
    newMode: fileRow.newMode,
    renameMetadata: fileRow.renameMetadata,
    hunks,
  });
}

function reviewToInsert(review: StoredReviewPr): ReviewInsert {
  return { ...review };
}

function revisionToInsert(revision: RevisionSnapshot, reviewId: ReviewPrId): RevisionInsert {
  const { reviewDisplayId: _reviewDisplayId, ...rest } = revision;
  return { ...rest, reviewId };
}

function insertDiffFiles(
  db: GreenroomDrizzleDatabase,
  revisionId: RevisionId,
  files: CreateDiffFileInput[],
): void {
  for (const file of files) {
    const fileId = storageId("diff_file");
    const fileInsert: DiffFileInsert = {
      id: fileId,
      revisionId,
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      isBinary: file.isBinary,
      additions: file.additions,
      deletions: file.deletions,
      oldMode: file.oldMode,
      newMode: file.newMode,
      renameMetadata: file.renameMetadata,
    };

    const hunkInputs = file.hunks ?? [];
    const parsedFile = diffFileSchema.parse({
      ...fileInsert,
      hunks: hunkInputs.map((hunk) => ({
        ...hunk,
        id: storageId("diff_hunk"),
        fileId,
      })),
    });

    db.insert(diffFiles).values(fileInsert).run();

    for (const hunk of parsedFile.hunks) {
      const hunkInsert: DiffHunkInsert = {
        id: hunk.id,
        fileId: hunk.fileId,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        header: hunk.header,
        lines: hunk.lines as DiffLine[],
        sortOrder: hunk.sortOrder,
      };

      db.insert(diffHunks).values(hunkInsert).run();
    }
  }
}

function storageId(prefix: "diff_file" | "diff_hunk"): string {
  return `${prefix}_${randomUUID()}`;
}

function nextReviewDisplayId(db: GreenroomDrizzleDatabase): ReviewDisplayId {
  return reviewDisplayIdSchema.parse(`GR-${allocateDisplayNumber(db, "review")}`);
}
