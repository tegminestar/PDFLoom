import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface EventsOverTimeChartProps {
  data: { date: string; count: number }[];
}

function formatTick(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { value: number; payload: { date: string } }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  if (!point) return null;
  return (
    <div className="rounded-[--radius-sm] border border-border-strong bg-surface px-3 py-2 shadow-[--shadow-floating]">
      <div className="text-sm font-semibold text-text">{point.value.toLocaleString()}</div>
      <div className="text-xs text-text-faint">{formatTick(point.payload.date)}</div>
    </div>
  );
}

/**
 * Daily event volume, last 30 days — a single series, so per dataviz
 * convention it carries no legend (the card title already says what's
 * plotted) and uses one sequential hue: the product's own primary accent,
 * a 2px line over a ~10% wash fill, never a saturated block.
 */
export function EventsOverTimeChart({ data }: EventsOverTimeChartProps) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            interval={Math.max(0, Math.ceil(data.length / 6) - 1)}
            tick={{ fill: "var(--color-text-faint)", fontSize: 11 }}
            axisLine={{ stroke: "var(--color-border)" }}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            width={32}
            tick={{ fill: "var(--color-text-faint)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="var(--color-primary)"
            fillOpacity={0.1}
            activeDot={{ r: 4, fill: "var(--color-primary)", stroke: "var(--color-surface)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
