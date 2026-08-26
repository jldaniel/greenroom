import { describe, expect, it } from "vitest";

import { spotlightActiveStep, spotlightRunSteps } from "./spotlightStepper";

describe("spotlightActiveStep", () => {
  it("maps context consent onto the Scope step", () => {
    expect(spotlightActiveStep("pending_consent", null)).toBe("scope");
    // A two-step profile can hold the durable workflow in pending_consent
    // while the Spotlight run record has already moved on.
    expect(spotlightActiveStep("queued", "pending_consent")).toBe("scope");
  });

  it("maps plan drafting and approval onto the Plan step", () => {
    expect(spotlightActiveStep("queued", "queued")).toBe("plan");
    expect(spotlightActiveStep("planning", "running")).toBe("plan");
    expect(spotlightActiveStep("awaiting_plan_approval", "awaiting_user")).toBe("plan");
  });

  it("maps generation onto the Views step", () => {
    expect(spotlightActiveStep("generating", "running")).toBe("views");
    expect(spotlightActiveStep("updating", null)).toBe("views");
  });

  it("returns null for settled runs", () => {
    expect(spotlightActiveStep("completed", "completed")).toBeNull();
    expect(spotlightActiveStep("failed", "failed")).toBeNull();
  });
});

describe("spotlightRunSteps", () => {
  it("marks steps before the active one complete and later ones upcoming", () => {
    expect(spotlightRunSteps("awaiting_plan_approval", null)).toEqual([
      { id: "scope", label: "Scope", status: "complete" },
      { id: "plan", label: "Plan", status: "active" },
      { id: "views", label: "Views", status: "upcoming" },
    ]);
  });

  it("starts at Scope during context consent", () => {
    expect(spotlightRunSteps("pending_consent", null)).toEqual([
      { id: "scope", label: "Scope", status: "active" },
      { id: "plan", label: "Plan", status: "upcoming" },
      { id: "views", label: "Views", status: "upcoming" },
    ]);
  });

  it("ends at Views during generation", () => {
    expect(spotlightRunSteps("generating", "running")).toEqual([
      { id: "scope", label: "Scope", status: "complete" },
      { id: "plan", label: "Plan", status: "complete" },
      { id: "views", label: "Views", status: "active" },
    ]);
  });

  it("returns null for settled runs", () => {
    expect(spotlightRunSteps("completed", null)).toBeNull();
    expect(spotlightRunSteps("failed", null)).toBeNull();
  });
});
