import { asc, desc, eq } from "drizzle-orm";

import {
  createComment,
  createThread,
  transitionThreadStatus,
  type DomainFactoryOptions,
  type StoredThread,
} from "@greenroom/core";
import {
  commentCreateInputSchema,
  commentSchema,
  threadCreateInputSchema,
  threadSchema,
  threadStatusSchema,
  threadWithCommentsSchema,
  type Comment,
  type CommentCreateInput,
  type ReviewPrId,
  type Thread,
  type ThreadAnchor,
  type ThreadCreateInput,
  type ThreadId,
  type ThreadReference,
  type ThreadStatus,
  type ThreadWithComments,
} from "@greenroom/schemas";

import { comments, reviewPrs, threads } from "../db/schema";
import type { GreenroomDrizzleDatabase } from "./database";
import { allocateDisplayNumber } from "./ref-counters";

type CommentRow = typeof comments.$inferSelect;
type ThreadRow = typeof threads.$inferSelect;
type CommentInsert = typeof comments.$inferInsert;
type ThreadInsert = typeof threads.$inferInsert;

export interface ThreadPersistenceService {
  create: (input: ThreadCreateInput) => ThreadWithComments;
  listByReview: (reviewId: ReviewPrId) => ThreadWithComments[];
  getByRef: (ref: ThreadReference) => ThreadWithComments | null;
  addComment: (input: CommentCreateInput) => Comment;
  transitionStatus: (ref: ThreadReference, status: ThreadStatus) => Thread | null;
  updateAnchor: (
    ref: ThreadReference,
    input: {
      anchor: ThreadAnchor;
      anchors?: ThreadAnchor[];
      remapConfidence: number | null;
      outdated: boolean;
    },
  ) => Thread | null;
}

export function createThreadPersistenceService(
  db: GreenroomDrizzleDatabase,
  options: DomainFactoryOptions = {},
): ThreadPersistenceService {
  return {
    create(input) {
      const parsed = threadCreateInputSchema.parse(input);

      return db.transaction((transaction) => {
        const review = transaction
          .select()
          .from(reviewPrs)
          .where(eq(reviewPrs.displayId, parsed.reviewDisplayId))
          .get();

        if (review === undefined) {
          throw new Error(`Review ${parsed.reviewDisplayId} was not found`);
        }

        const created = createThread(parsed, {
          ...options,
          nextThreadNumber: allocateDisplayNumber(transaction, "thread"),
        });

        transaction.insert(threads).values(threadToInsert(created.thread, review.id)).run();
        transaction
          .insert(comments)
          .values(commentToInsert(created.firstComment, created.thread.id))
          .run();
        transaction
          .update(reviewPrs)
          .set({ updatedAt: created.thread.updatedAt })
          .where(eq(reviewPrs.id, review.id))
          .run();

        const { id: _id, ...thread } = created.thread;
        return threadWithCommentsSchema.parse({
          ...thread,
          comments: [created.firstComment],
        });
      });
    },

    listByReview(reviewId) {
      const threadRows = db
        .select()
        .from(threads)
        .where(eq(threads.reviewId, reviewId))
        .orderBy(asc(threads.createdAt))
        .all();

      return threadRows.map((threadRow) => readThreadWithComments(db, threadRow));
    },

    getByRef(ref) {
      const row = db.select().from(threads).where(eq(threads.shortRef, ref)).get();

      return row === undefined ? null : readThreadWithComments(db, row);
    },

    addComment(input) {
      const parsed = commentCreateInputSchema.parse(input);
      const threadRow = db
        .select()
        .from(threads)
        .where(eq(threads.shortRef, parsed.threadRef))
        .get();

      if (threadRow === undefined) {
        throw new Error(`Thread ${parsed.threadRef} was not found`);
      }

      const lastComment = db
        .select()
        .from(comments)
        .where(eq(comments.threadId, threadRow.id))
        .orderBy(desc(comments.sortOrder))
        .limit(1)
        .get();

      const comment = createComment(parsed, {
        ...options,
        sortOrder: (lastComment?.sortOrder ?? 0) + 1,
      });

      db.insert(comments).values(commentToInsert(comment, threadRow.id)).run();
      return comment;
    },

    transitionStatus(ref, status) {
      const parsedStatus = threadStatusSchema.parse(status);
      const row = db.select().from(threads).where(eq(threads.shortRef, ref)).get();

      if (row === undefined) {
        return null;
      }

      const transitioned = transitionThreadStatus(parseThread(row), parsedStatus, options);
      db.update(threads)
        .set({ status: transitioned.status, updatedAt: transitioned.updatedAt })
        .where(eq(threads.id, row.id))
        .run();

      return transitioned;
    },

    updateAnchor(ref, input) {
      const row = db.select().from(threads).where(eq(threads.shortRef, ref)).get();

      if (row === undefined) {
        return null;
      }

      const updated = threadSchema.parse({
        ...parseThread(row),
        anchor: input.anchor,
        anchors: input.anchors ?? [input.anchor],
        remapConfidence: input.remapConfidence,
        outdated: input.outdated,
        updatedAt: options.clock?.() ?? new Date().toISOString(),
      });

      db.update(threads)
        .set({
          anchor: updated.anchor,
          anchors: updated.anchors,
          remapConfidence: updated.remapConfidence,
          outdated: updated.outdated,
          updatedAt: updated.updatedAt,
        })
        .where(eq(threads.id, row.id))
        .run();

      return updated;
    },
  };
}

export function parseThread(row: ThreadRow): Thread {
  return threadSchema.parse({
    reviewDisplayId: threadRowReviewDisplayId(row),
    shortRef: row.shortRef,
    status: row.status,
    type: row.type,
    severity: row.severity,
    source: row.source,
    anchor: row.anchor,
    anchors: row.anchors ?? [row.anchor],
    remapConfidence: row.remapConfidence,
    outdated: row.outdated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function parseComment(row: CommentRow, threadRef: string): Comment {
  return commentSchema.parse({
    id: row.id,
    threadRef,
    parentCommentId: row.parentCommentId,
    authorKind: row.authorKind,
    authorDisplayName: row.authorDisplayName,
    body: row.body,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  });
}

function readThreadWithComments(
  db: GreenroomDrizzleDatabase,
  threadRow: ThreadRow,
): ThreadWithComments {
  const threadComments = db
    .select()
    .from(comments)
    .where(eq(comments.threadId, threadRow.id))
    .orderBy(asc(comments.sortOrder))
    .all()
    .map((row) => parseComment(row, threadRow.shortRef));

  return threadWithCommentsSchema.parse({
    ...parseThread(threadRow),
    comments: threadComments,
  });
}

/**
 * Thread anchors already carry the review display ref (GR-n), so the row's
 * persisted anchor JSON is the source of the thread's reviewDisplayId when
 * rehydrating without a join.
 */
function threadRowReviewDisplayId(row: ThreadRow): string {
  return (row.anchor as ThreadAnchor).reviewDisplayId;
}

function threadToInsert(thread: StoredThread, reviewId: ReviewPrId): ThreadInsert {
  const { reviewDisplayId: _reviewDisplayId, ...rest } = thread;
  return { ...rest, reviewId };
}

function commentToInsert(comment: Comment, threadId: ThreadId): CommentInsert {
  const { threadRef: _threadRef, ...rest } = comment;
  return { ...rest, threadId };
}
