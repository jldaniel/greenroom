import { HelpCircle, MessageSquarePlus, RotateCcw } from "lucide-react";

import type {
  StructuredTeachingOutput,
  TeachingContextFile,
  TeachingQuizQuestion,
} from "@greenroom/schemas";

import { ExcerptSnippet } from "./ExcerptSnippet";
import { aggregateMissedConcepts, deriveQuizProgress, type QuizAnswerMap } from "./quizProgress";
import type { TeachingPromotedPoint } from "./teachingSessionUtils";

/**
 * Interactive quiz for the Teach page. All questions are visible;
 * selection is per-question and locks in with immediate right/wrong feedback
 * plus the explanation. Once every question is answered a score summary
 * (N/M) appears together with the aggregated missed concepts (per-question
 * `missedConcept` from wrong answers plus the output-level `missedConcepts`).
 * Answers are client-side session state; nothing is posted to the API.
 */
export function TeachingQuiz({
  answers,
  contextFiles,
  onAnswer,
  onPromote,
  onReset,
  output,
}: {
  answers: QuizAnswerMap;
  contextFiles: readonly TeachingContextFile[];
  onAnswer: (questionId: string, choiceId: string) => void;
  onPromote: (point: TeachingPromotedPoint) => void;
  onReset: () => void;
  output: StructuredTeachingOutput;
}) {
  const progress = deriveQuizProgress(output.quiz, answers);
  const missedConcepts = progress.isComplete
    ? aggregateMissedConcepts(output.quiz, answers, output.missedConcepts)
    : [];

  return (
    <section aria-label="Quiz" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-muted">Quiz</p>
        <p aria-live="polite" className="text-xs tabular-nums text-muted">
          {progress.answeredCount} of {progress.totalCount} answered
        </p>
      </div>
      {output.quiz.map((question) => (
        <QuizQuestionCard
          answer={answers[question.id] ?? null}
          contextFiles={contextFiles}
          key={question.id}
          onAnswer={(choiceId) => onAnswer(question.id, choiceId)}
          onPromote={onPromote}
          question={question}
        />
      ))}
      {progress.isComplete ? (
        <div
          aria-live="polite"
          className="rounded-lg border border-line bg-muted-surface p-4"
          data-testid="quiz-score-summary"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              Score: {progress.correctCount}/{progress.totalCount}
            </p>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-surface px-2 text-xs font-medium hover:bg-muted-surface"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              Retake quiz
            </button>
          </div>
          {missedConcepts.length === 0 ? (
            <p className="mt-2 text-sm text-success-ink">No missed concepts - nice work.</p>
          ) : (
            <div className="mt-2" data-testid="quiz-missed-concepts">
              <p className="text-xs font-medium uppercase text-muted">Concepts to revisit</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {missedConcepts.map((concept) => (
                  <li className="break-words" key={concept}>
                    {concept}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function QuizQuestionCard({
  answer,
  contextFiles,
  onAnswer,
  onPromote,
  question,
}: {
  answer: string | null;
  contextFiles: readonly TeachingContextFile[];
  onAnswer: (choiceId: string) => void;
  onPromote: (point: TeachingPromotedPoint) => void;
  question: TeachingQuizQuestion;
}) {
  const answered = answer !== null;
  const isCorrect = answer !== null && answer === question.correctChoiceId;
  const excerpts = question.excerpts ?? [];

  return (
    <article className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start gap-2">
        <HelpCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <p className="min-w-0 [overflow-wrap:anywhere] text-sm font-medium">{question.prompt}</p>
      </div>
      {excerpts.length === 0 ? null : (
        <div className="mt-3 space-y-2">
          {excerpts.map((excerptRef, index) => (
            <ExcerptSnippet contextFiles={contextFiles} excerptRef={excerptRef} key={index} />
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-2">
        {question.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            disabled={answered}
            onClick={() => onAnswer(choice.id)}
            className={quizChoiceClassName(answer, choice.id, question.correctChoiceId)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {answer === null ? null : (
        <div className="mt-3 rounded-lg border border-line bg-muted-surface p-3 text-sm">
          <p
            className={isCorrect ? "font-medium text-success-ink" : "font-medium text-warning-ink"}
          >
            {isCorrect ? "Correct" : "Review this concept"}
          </p>
          <p className="mt-1">{question.explanation}</p>
          {isCorrect ? null : (
            <button
              type="button"
              onClick={() =>
                onPromote({
                  title: question.missedConcept,
                  body: question.explanation,
                  anchor: question.anchor,
                })
              }
              className="mt-3 inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-surface px-2 text-xs font-medium hover:bg-muted-surface"
            >
              <MessageSquarePlus aria-hidden="true" className="size-4" />
              Promote
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function quizChoiceClassName(
  answer: string | null,
  choiceId: string,
  correctChoiceId: string,
): string {
  const answered = answer !== null;
  const isSelected = answer === choiceId;
  const isCorrect = choiceId === correctChoiceId;

  if (!answered) {
    return "rounded-md border border-line bg-muted-surface px-3 py-2 text-left text-sm hover:bg-surface";
  }

  if (isCorrect) {
    return "rounded-md border border-success/30 bg-success-soft px-3 py-2 text-left text-sm text-success-ink";
  }

  if (isSelected) {
    return "rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-left text-sm text-warning-ink";
  }

  return "rounded-md border border-line bg-muted-surface px-3 py-2 text-left text-sm text-muted";
}
