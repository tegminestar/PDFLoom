import type { StampPreset } from "@pdfloom/core";
import { IconButton, Separator, TopBar, TopBarSection, cn } from "@pdfloom/ui";
import {
  Circle,
  Highlighter,
  MoveUpRight,
  Pencil,
  Square,
  Stamp,
  Strikethrough,
  Type,
  Underline,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { ANNOTATE_COLOR_PRESETS, type AnnotateTool } from "../../app/store";
import { useLoomStore } from "../../app/store";
import { PageNumberField } from "../viewer/PageNumberField";
import { ZoomControls } from "../viewer/ZoomControls";

const TOOLS: { id: AnnotateTool; label: string; icon: ReactNode }[] = [
  { id: "highlight", label: "Highlight text", icon: <Highlighter /> },
  { id: "underline", label: "Underline text", icon: <Underline /> },
  { id: "strikeout", label: "Strikethrough text", icon: <Strikethrough /> },
  { id: "ink", label: "Draw freehand", icon: <Pencil /> },
  { id: "square", label: "Rectangle", icon: <Square /> },
  { id: "circle", label: "Ellipse", icon: <Circle /> },
  { id: "line", label: "Line / arrow", icon: <MoveUpRight /> },
  { id: "text", label: "Add comment", icon: <Type /> },
  { id: "stamp", label: "Stamp", icon: <Stamp /> },
];

const STAMP_PRESETS: { id: StampPreset; label: string }[] = [
  { id: "approved", label: "Approved" },
  { id: "draft", label: "Draft" },
  { id: "confidential", label: "Confidential" },
  { id: "rejected", label: "Rejected" },
];

const MARKUP_TOOLS: AnnotateTool[] = ["highlight", "underline", "strikeout"];

export function AnnotateToolbar() {
  const tool = useLoomStore((s) => s.annotateTool);
  const setTool = useLoomStore((s) => s.setAnnotateTool);
  const color = useLoomStore((s) => s.annotateColor);
  const setColor = useLoomStore((s) => s.setAnnotateColor);
  const stampPreset = useLoomStore((s) => s.annotateStampPreset);
  const setStampPreset = useLoomStore((s) => s.setAnnotateStampPreset);
  const setAnnotateOpen = useLoomStore((s) => s.setAnnotateOpen);

  return (
    <TopBar>
      <TopBarSection>
        <span className="mr-2 text-sm font-semibold text-text">Annotate</span>
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
      </TopBarSection>

      <TopBarSection align="center">
        <span className="mr-2 hidden text-xs text-text-faint lg:inline">
          {MARKUP_TOOLS.includes(tool) ? "Select text, then click a color" : "Click or drag on the page"}
        </span>
        {TOOLS.map((t) => (
          <IconButton
            key={t.id}
            icon={t.icon}
            label={t.label}
            variant={tool === t.id ? "active" : "default"}
            onClick={() => setTool(t.id)}
          />
        ))}

        {tool === "stamp" && (
          <>
            <Separator orientation="vertical" className="mx-1.5 h-6" />
            <select
              value={stampPreset}
              onChange={(e) => setStampPreset(e.target.value as StampPreset)}
              className="h-8 rounded-[--radius-sm] border border-border-strong bg-surface px-2 text-sm text-text outline-none"
            >
              {STAMP_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}

        {tool !== "stamp" && (
          <>
            <Separator orientation="vertical" className="mx-1.5 h-6" />
            <div className="flex items-center gap-1">
              {ANNOTATE_COLOR_PRESETS.map((c, i) => {
                const hex = `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`;
                const active = c.r === color.r && c.g === color.g && c.b === color.b;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Color ${i + 1}`}
                    onClick={() => setColor(c)}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-transform",
                      active ? "scale-110 border-text" : "border-transparent hover:scale-105",
                    )}
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
          </>
        )}
      </TopBarSection>

      <TopBarSection align="end">
        <IconButton icon={<X />} label="Exit annotate mode" onClick={() => setAnnotateOpen(false)} showTooltip={false} />
      </TopBarSection>
    </TopBar>
  );
}
