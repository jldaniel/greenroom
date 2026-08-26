import type { Context } from "hono";
import * as z from "zod";

import { ApiHttpError } from "./errors";

export async function parseJsonBody<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  const body = await readJsonBody(context);
  return schema.parse(body);
}

export function parseQuery<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): z.output<Schema> {
  const query: Record<string, string> = {};
  const searchParams = new URL(context.req.url).searchParams;

  for (const [key, value] of searchParams) {
    query[key] = value;
  }

  return schema.parse(query);
}

export function parsePathParam<Schema extends z.ZodType>(
  context: Context,
  name: string,
  schema: Schema,
): z.output<Schema> {
  return schema.parse(context.req.param(name));
}

async function readJsonBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new ApiHttpError(400, "bad_request", "Request body must be valid JSON");
  }
}
