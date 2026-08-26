import { useCallback } from "react";

import type { ReviewReference, ThreadRef, ThreadStatus } from "@greenroom/schemas";

import type { SpotlightViewResource } from "../../api/client";
import { useCreateThread, useReplyToThread, useTransitionThreadStatus } from "../../api/hooks";
import type { ThreadComposerValues } from "../ThreadTriage";
import type { WorkspaceSelectionController } from "./useWorkspaceSelection";

export interface ThreadActionsController {
  createThread: (values: ThreadComposerValues) => Promise<void>;
  error: unknown;
  isCreating: boolean;
  isReplying: boolean;
  isTransitioning: boolean;
  replyToThread: (threadRef: ThreadRef, body: string) => Promise<void>;
  transitionThread: (threadRef: ThreadRef, status: ThreadStatus) => Promise<void>;
}

type ThreadSelection = Pick<
  WorkspaceSelectionController,
  "composerAnchor" | "composerAnchors" | "setComposerAnchors" | "setSelectedThreadRef"
>;

/**
 * Thread mutations for the workspace: create from the composer anchors,
 * reply, and triage transitions. Threads created while a Spotlight View
 * filters the diff record that View as source metadata.
 */
export function useThreadActions({
  reviewId,
  selection,
  spotlightView,
}: {
  reviewId: ReviewReference;
  selection: ThreadSelection;
  spotlightView: SpotlightViewResource | null;
}): ThreadActionsController {
  const createThread = useCreateThread();
  const replyToThread = useReplyToThread();
  const transitionThread = useTransitionThreadStatus();
  const { composerAnchor, composerAnchors, setComposerAnchors, setSelectedThreadRef } = selection;

  const handleCreateThread = useCallback(
    async (values: ThreadComposerValues) => {
      if (composerAnchor === null) {
        return;
      }

      const thread = await createThread.mutateAsync({
        reviewId,
        input: {
          reviewDisplayId: reviewId,
          type: values.type,
          severity: values.severity,
          source: {
            kind: "human",
            displayName: "Reviewer",
            ...(spotlightView !== null
              ? {
                  metadata: {
                    spotlightViewRef: spotlightView.displayRef,
                    spotlightViewTitle: spotlightView.title,
                  },
                }
              : {}),
          },
          anchor: composerAnchor,
          anchors: composerAnchors.length === 0 ? [composerAnchor] : composerAnchors,
          firstComment: {
            authorKind: "human",
            authorDisplayName: "Reviewer",
            body: values.body,
          },
        },
      });

      setComposerAnchors([]);
      setSelectedThreadRef(thread.shortRef);
    },
    [
      composerAnchor,
      composerAnchors,
      createThread,
      reviewId,
      setComposerAnchors,
      setSelectedThreadRef,
      spotlightView,
    ],
  );

  const handleReplyToThread = useCallback(
    async (threadRef: ThreadRef, body: string) => {
      await replyToThread.mutateAsync({
        reviewId,
        threadRef,
        input: {
          authorKind: "human",
          authorDisplayName: "Reviewer",
          body,
        },
      });
      setSelectedThreadRef(threadRef);
    },
    [replyToThread, reviewId, setSelectedThreadRef],
  );

  const handleTransitionThread = useCallback(
    async (threadRef: ThreadRef, status: ThreadStatus) => {
      const thread = await transitionThread.mutateAsync({
        reviewId,
        threadRef,
        status,
      });
      setSelectedThreadRef(thread.shortRef);
    },
    [reviewId, setSelectedThreadRef, transitionThread],
  );

  return {
    createThread: handleCreateThread,
    error: createThread.error ?? replyToThread.error ?? transitionThread.error,
    isCreating: createThread.isPending,
    isReplying: replyToThread.isPending,
    isTransitioning: transitionThread.isPending,
    replyToThread: handleReplyToThread,
    transitionThread: handleTransitionThread,
  };
}
