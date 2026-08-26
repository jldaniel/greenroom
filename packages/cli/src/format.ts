/** Plain-text table formatting for `greenroom status` and `greenroom config`. */

export interface ServiceStatusRow {
  name: string;
  state: string;
  port: number | null;
  pid: number | null;
  url: string | null;
}

export function formatServiceTable(rows: readonly ServiceStatusRow[]): string {
  const table: string[][] = [
    ["SERVICE", "STATE", "PORT", "PID", "URL"],
    ...rows.map((row) => [
      row.name,
      row.state,
      row.port === null ? "-" : String(row.port),
      row.pid === null ? "-" : String(row.pid),
      row.url ?? "-",
    ]),
  ];

  return formatColumns(table);
}

export interface ConfigKeyRow {
  key: string;
  source: string;
  value: string;
}

export function formatConfigTable(rows: readonly ConfigKeyRow[]): string {
  const table: string[][] = [
    ["KEY", "SOURCE", "VALUE"],
    ...rows.map((row) => [row.key, row.source, row.value]),
  ];

  return formatColumns(table);
}

function formatColumns(table: readonly (readonly string[])[]): string {
  const widths: number[] = [];

  for (const row of table) {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, cell.length);
    });
  }

  return table
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? cell.length),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
