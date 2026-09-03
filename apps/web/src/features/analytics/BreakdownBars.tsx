export interface BreakdownBarsProps {
  title: string;
  rows: { name: string; count: number }[];
  /** A CSS color value (e.g. "var(--color-primary)") — one hue per card, not per row: each row is already identified by its own label, so per-row color would be decorative, not informational. */
  accent: string;
}

export function BreakdownBars({ title, rows, accent }: BreakdownBarsProps) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="flex flex-col gap-3 rounded-[--radius-md] border border-border bg-surface p-4">
      <span className="text-sm text-text-muted">{title}</span>
      {rows.length === 0 ? (
        <p className="text-sm text-text-faint">No data yet</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const pct = total === 0 ? 0 : Math.round((row.count / total) * 100);
            return (
              <div key={row.name} className="flex items-center gap-2.5" title={`${row.name}: ${row.count.toLocaleString()} (${pct}%)`}>
                <span className="w-24 shrink-0 truncate text-sm text-text">{row.name}</span>
                <div className="h-2.5 flex-1 rounded-full bg-bg">
                  <div
                    className="h-full rounded-r-[4px]"
                    style={{ width: `${Math.max(4, (row.count / max) * 100)}%`, backgroundColor: accent }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-text-muted">{row.count.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
