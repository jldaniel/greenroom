import { createGreenroomHttpClient, type GreenroomHttpClientOptions } from "./client";
import { createGreenroomMcpServer } from "./server";

export interface GreenroomStdioServerOptions {
  client?: GreenroomHttpClientOptions;
}

export async function runGreenroomStdioServer(
  options: GreenroomStdioServerOptions = {},
): Promise<void> {
  const token = options.client?.token ?? Bun.env.GREENROOM_API_TOKEN;

  if (token === undefined || token.trim().length === 0) {
    throw new Error("GREENROOM_API_TOKEN is required to start the Greenroom MCP stdio server");
  }

  const client = createGreenroomHttpClient({
    baseUrl: options.client?.baseUrl ?? Bun.env.GREENROOM_API_BASE_URL ?? "http://127.0.0.1:49331",
    token,
    ...(options.client?.fetch !== undefined ? { fetch: options.client.fetch } : {}),
  });
  const server = createGreenroomMcpServer({ client });
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        const response = await server.handleMessage(JSON.parse(line) as unknown);

        if (response !== null) {
          console.log(JSON.stringify(response));
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }
  }
}

if (import.meta.main) {
  runGreenroomStdioServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    throw error;
  });
}
