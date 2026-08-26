import { GreenroomApiError } from "./api/client";

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function compactSha(value: string | null | undefined): string {
  return value === null || value === undefined ? "None" : value.slice(0, 12);
}

export function messageForError(error: unknown): string {
  if (error instanceof GreenroomApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
