import { FileText, GitCompareArrows, Minus, Plus } from "lucide-react";

import type { DiffSummary as DiffSummaryShape } from "@greenroom/schemas";

export function DiffSummary({ summary }: { summary: DiffSummaryShape }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat icon={<FileText className="size-4" />} label="Files" value={summary.fileCount} />
      <Stat icon={<Plus className="size-4" />} label="Added" value={summary.additions} tone="add" />
      <Stat
        icon={<Minus className="size-4" />}
        label="Deleted"
        value={summary.deletions}
        tone="delete"
      />
      <Stat
        icon={<GitCompareArrows className="size-4" />}
        label="Renamed"
        value={summary.renameCount}
      />
      <Stat icon={<FileText className="size-4" />} label="Binary" value={summary.binaryFileCount} />
    </dl>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "add" | "delete";
}

function Stat({ icon, label, value, tone }: StatProps) {
  const toneClass =
    tone === "add" ? "text-success-ink" : tone === "delete" ? "text-danger-ink" : "text-ink";

  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-3">
      <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-muted">
        {icon}
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}
