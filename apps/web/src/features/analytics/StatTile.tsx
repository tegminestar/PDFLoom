const compactFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export interface StatTileProps {
  label: string;
  value: number;
}

export function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[--radius-md] border border-border bg-surface p-4">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-3xl font-semibold text-text">{compactFormatter.format(value)}</span>
    </div>
  );
}
