import { describe, expect, it } from "vitest";

import type { TeachingQuizQuestion } from "@greenroom/schemas";

import { aggregateMissedConcepts, deriveQuizProgress } from "./quizProgress";

function question(overrides: Partial<TeachingQuizQuestion>): TeachingQuizQuestion {
  return {
    id: "quiz-1",
    prompt: "What changed?",
    choices: [
      { id: "a", label: "Choice A" },
      { id: "b", label: "Choice B" },
    ],
    correctChoiceId: "a",
    explanation: "Because A.",
    missedConcept: "Concept A",
    anchor: null,
    excerpts: [],
    ...overrides,
  };
}

const quiz = [
  question({ id: "quiz-1", correctChoiceId: "a", missedConcept: "Read the diff first" }),
  question({ id: "quiz-2", correctChoiceId: "b", missedConcept: "Check the call sites" }),
  question({ id: "quiz-3", correctChoiceId: "a", missedConcept: "Read the diff first" }),
];

describe("deriveQuizProgress", () => {
  it("tracks answered and correct counts until completion", () => {
    expect(deriveQuizProgress(quiz, {})).toEqual({
      totalCount: 3,
      answeredCount: 0,
      correctCount: 0,
      isComplete: false,
    });

    expect(deriveQuizProgress(quiz, { "quiz-1": "a", "quiz-2": "a" })).toEqual({
      totalCount: 3,
      answeredCount: 2,
      correctCount: 1,
      isComplete: false,
    });

    expect(deriveQuizProgress(quiz, { "quiz-1": "a", "quiz-2": "a", "quiz-3": "a" })).toEqual({
      totalCount: 3,
      answeredCount: 3,
      correctCount: 2,
      isComplete: true,
    });
  });

  it("never reports an empty quiz as complete", () => {
    expect(deriveQuizProgress([], {}).isComplete).toBe(false);
  });
});

describe("aggregateMissedConcepts", () => {
  it("collects concepts from wrong answers before output-level concepts, deduplicated", () => {
    const concepts = aggregateMissedConcepts(
      quiz,
      { "quiz-1": "b", "quiz-2": "b", "quiz-3": "b" },
      ["Overall architecture", "Read the diff first"],
    );

    expect(concepts).toEqual(["Read the diff first", "Overall architecture"]);
  });

  it("keeps output-level concepts even when every answer is correct", () => {
    const concepts = aggregateMissedConcepts(
      quiz,
      { "quiz-1": "a", "quiz-2": "b", "quiz-3": "a" },
      ["Overall architecture"],
    );

    expect(concepts).toEqual(["Overall architecture"]);
  });

  it("ignores unanswered questions and blank concepts", () => {
    const blankConceptQuiz = [
      question({ id: "quiz-1", correctChoiceId: "a", missedConcept: "   " }),
    ];

    expect(aggregateMissedConcepts(blankConceptQuiz, { "quiz-1": "b" }, [])).toEqual([]);
    expect(aggregateMissedConcepts(quiz, {}, [])).toEqual([]);
  });
});
