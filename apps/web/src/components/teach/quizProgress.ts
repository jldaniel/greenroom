import type { TeachingQuizQuestion } from "@greenroom/schemas";

/**
 * Pure quiz scoring for the interactive Teach quiz. Quiz answers are
 * client-side session state (nothing in the API accepts
 * `teachingQuizAnswerSchema` records today); this module derives the score
 * summary and the missed-concept aggregation from the selected choices.
 */

export type QuizAnswerMap = Readonly<Record<string, string>>;

export interface QuizProgress {
  totalCount: number;
  answeredCount: number;
  correctCount: number;
  isComplete: boolean;
}

export function deriveQuizProgress(
  quiz: readonly TeachingQuizQuestion[],
  answers: QuizAnswerMap,
): QuizProgress {
  let answeredCount = 0;
  let correctCount = 0;

  for (const question of quiz) {
    const answer = answers[question.id];

    if (answer === undefined) {
      continue;
    }

    answeredCount += 1;

    if (answer === question.correctChoiceId) {
      correctCount += 1;
    }
  }

  return {
    totalCount: quiz.length,
    answeredCount,
    correctCount,
    isComplete: quiz.length > 0 && answeredCount === quiz.length,
  };
}

/**
 * Aggregates the concepts the learner should revisit: `missedConcept` from
 * every wrongly-answered quiz question first, then the output-level
 * `missedConcepts` the model flagged for the whole change, deduplicated in
 * that order.
 */
export function aggregateMissedConcepts(
  quiz: readonly TeachingQuizQuestion[],
  answers: QuizAnswerMap,
  outputMissedConcepts: readonly string[],
): string[] {
  const concepts: string[] = [];
  const seen = new Set<string>();

  function add(concept: string): void {
    const trimmed = concept.trim();

    if (trimmed.length === 0 || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    concepts.push(trimmed);
  }

  for (const question of quiz) {
    const answer = answers[question.id];

    if (answer !== undefined && answer !== question.correctChoiceId) {
      add(question.missedConcept);
    }
  }

  for (const concept of outputMissedConcepts) {
    add(concept);
  }

  return concepts;
}
