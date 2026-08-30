export interface QuickCreateContent {
  title: string;
  bullets: string[];
}

export interface ColorScheme {
  id: string;
  label: string;
  background: string;
  accent: string;
  titleColor: string;
  bodyColor: string;
}

export const COLOR_SCHEMES: ColorScheme[] = [
  { id: "indigo", label: "Indigo", background: "#0F1115", accent: "#6C5CE7", titleColor: "#FAF9F6", bodyColor: "#C9CBD4" },
  { id: "paper", label: "Paper", background: "#FAF9F6", accent: "#6C5CE7", titleColor: "#16181D", bodyColor: "#4A4D57" },
  { id: "amber", label: "Amber", background: "#1A1204", accent: "#F5A623", titleColor: "#FAF9F6", bodyColor: "#D9CBA8" },
];

export type TemplateId = "social" | "flyer" | "slide";

export interface TemplateSpec {
  id: TemplateId;
  label: string;
  width: number;
  height: number;
}

export const TEMPLATES: TemplateSpec[] = [
  { id: "social", label: "Social graphic (square)", width: 1080, height: 1080 },
  { id: "flyer", label: "Flyer (portrait)", width: 816, height: 1056 },
  { id: "slide", label: "Slide (16:9)", width: 1280, height: 720 },
];

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Draws the given template onto a canvas already sized to match its TemplateSpec's width/height. Every template shares the same content shape (title + bullets) and color scheme, differing only in layout. */
export function drawTemplate(ctx: CanvasRenderingContext2D, templateId: TemplateId, content: QuickCreateContent, scheme: ColorScheme, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = scheme.background;
  ctx.fillRect(0, 0, width, height);

  const margin = width * 0.08;
  const contentWidth = width - margin * 2;

  if (templateId === "social") {
    ctx.fillStyle = scheme.accent;
    ctx.fillRect(margin, margin, width * 0.14, height * 0.01);

    ctx.fillStyle = scheme.titleColor;
    ctx.font = `700 ${Math.round(width * 0.065)}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    let y = margin + height * 0.05;
    for (const line of wrapText(ctx, content.title, contentWidth)) {
      ctx.fillText(line, margin, y);
      y += width * 0.078;
    }

    y += height * 0.04;
    ctx.font = `400 ${Math.round(width * 0.032)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = scheme.bodyColor;
    for (const bullet of content.bullets) {
      ctx.fillStyle = scheme.accent;
      ctx.beginPath();
      ctx.arc(margin + width * 0.008, y + width * 0.016, width * 0.006, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = scheme.bodyColor;
      const lines = wrapText(ctx, bullet, contentWidth - width * 0.03);
      for (const line of lines) {
        ctx.fillText(line, margin + width * 0.03, y);
        y += width * 0.042;
      }
      y += width * 0.014;
    }
  } else if (templateId === "flyer") {
    ctx.fillStyle = scheme.accent;
    ctx.fillRect(0, 0, width, height * 0.03);

    ctx.fillStyle = scheme.titleColor;
    ctx.font = `700 ${Math.round(width * 0.075)}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    let y = height * 0.1;
    for (const line of wrapText(ctx, content.title, contentWidth)) {
      ctx.fillText(line, margin, y);
      y += width * 0.09;
    }

    y += height * 0.05;
    ctx.strokeStyle = scheme.accent;
    ctx.lineWidth = width * 0.004;
    ctx.beginPath();
    ctx.moveTo(margin, y);
    ctx.lineTo(margin + width * 0.15, y);
    ctx.stroke();
    y += height * 0.04;

    ctx.font = `400 ${Math.round(width * 0.036)}px Inter, system-ui, sans-serif`;
    for (const bullet of content.bullets) {
      ctx.fillStyle = scheme.accent;
      ctx.beginPath();
      ctx.arc(margin + width * 0.008, y + width * 0.017, width * 0.007, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = scheme.bodyColor;
      const lines = wrapText(ctx, bullet, contentWidth - width * 0.035);
      for (const line of lines) {
        ctx.fillText(line, margin + width * 0.035, y);
        y += width * 0.048;
      }
      y += width * 0.02;
    }
  } else {
    // slide (16:9): title top-left, accent bar on the left edge, bullets fill the remaining width.
    ctx.fillStyle = scheme.accent;
    ctx.fillRect(0, 0, width * 0.012, height);

    ctx.fillStyle = scheme.titleColor;
    ctx.font = `700 ${Math.round(height * 0.09)}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    let y = height * 0.12;
    for (const line of wrapText(ctx, content.title, contentWidth)) {
      ctx.fillText(line, margin, y);
      y += height * 0.11;
    }

    y += height * 0.06;
    ctx.font = `400 ${Math.round(height * 0.045)}px Inter, system-ui, sans-serif`;
    for (const bullet of content.bullets) {
      ctx.fillStyle = scheme.accent;
      ctx.beginPath();
      ctx.arc(margin + width * 0.006, y + height * 0.02, height * 0.008, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = scheme.bodyColor;
      const lines = wrapText(ctx, bullet, contentWidth - width * 0.03);
      for (const line of lines) {
        ctx.fillText(line, margin + width * 0.03, y);
        y += height * 0.06;
      }
      y += height * 0.02;
    }
  }
}
