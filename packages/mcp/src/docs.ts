import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { listGreenroomResources, listGreenroomResourceTemplates } from "./resources";
import { listGreenroomTools, type GreenroomToolDefinition } from "./tools";

export const mcpDocPath = fileURLToPath(new URL("../../../docs/MCP.md", import.meta.url));

interface GeneratedDocSection {
  id: string;
  render: () => string;
}

const generatedDocSections: GeneratedDocSection[] = [
  { id: "mcp-tools", render: renderMcpToolsTable },
  { id: "mcp-resources", render: renderMcpResourcesList },
];

export function renderMcpToolsTable(): string {
  return renderTable(
    ["Tool", "Arguments", "Description"],
    listGreenroomTools().map((tool) => [
      `\`${tool.name}\``,
      toolArgumentsCell(tool),
      tool.description,
    ]),
  );
}

export function renderMcpResourcesList(): string {
  const concrete = listGreenroomResources().map(
    (resource) => `- \`${resource.uri}\` - ${resource.description}`,
  );
  const templates = listGreenroomResourceTemplates().map(
    (resource) => `- \`${resource.uriTemplate}\` - ${resource.description}`,
  );

  return [
    "The adapter advertises these concrete resources:",
    "",
    ...concrete,
    "",
    "And these resource templates:",
    "",
    ...templates,
  ].join("\n");
}

export function applyGeneratedDocSections(markdown: string): string {
  return generatedDocSections.reduce(
    (document, section) => replaceGeneratedSection(document, section.id, section.render()),
    markdown,
  );
}

function replaceGeneratedSection(markdown: string, id: string, content: string): string {
  const begin = `<!-- BEGIN GENERATED: ${id} (bun run docs:mcp) -->`;
  const end = `<!-- END GENERATED: ${id} -->`;
  const beginIndex = markdown.indexOf(begin);
  const endIndex = markdown.indexOf(end);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(`Generated-section markers for ${id} not found in docs/MCP.md`);
  }

  return `${markdown.slice(0, beginIndex + begin.length)}\n\n${content}\n\n${markdown.slice(endIndex)}`;
}

function toolArgumentsCell(tool: GreenroomToolDefinition): string {
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  const names = Object.keys(schema.properties ?? {});

  if (names.length === 0) {
    return "None";
  }

  return names
    .map((name) => (required.has(name) ? `\`${name}\`` : `optional \`${name}\``))
    .join(", ");
}

function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const renderRow = (cells: string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;

  return [renderRow(header), separator, ...rows.map(renderRow)].join("\n");
}

if (import.meta.main) {
  const current = readFileSync(mcpDocPath, "utf8");
  const next = applyGeneratedDocSections(current);

  if (next === current) {
    console.log("docs/MCP.md generated sections already up to date");
  } else {
    writeFileSync(mcpDocPath, next);
    console.log("docs/MCP.md generated sections updated");
  }
}
