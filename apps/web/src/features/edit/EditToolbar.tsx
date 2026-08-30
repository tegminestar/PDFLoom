import { IconButton, Separator, TopBar, TopBarSection } from "@pdfloom/ui";
import { Image as ImageIcon, Type, X } from "lucide-react";
import { useLoomStore, type EditTool } from "../../app/store";
import { PageNumberField } from "../viewer/PageNumberField";
import { ZoomControls } from "../viewer/ZoomControls";

const TOOLS: { id: EditTool; label: string; hint: string }[] = [
  { id: "text", label: "Edit text", hint: "Click any text on the page, then type its replacement" },
  { id: "image", label: "Replace image", hint: "Drag a box over an image, then choose its replacement" },
];

export function EditToolbar() {
  const tool = useLoomStore((s) => s.editTool);
  const setEditTool = useLoomStore((s) => s.setEditTool);
  const setEditOpen = useLoomStore((s) => s.setEditOpen);

  const active = TOOLS.find((t) => t.id === tool)!;

  return (
    <TopBar>
      <TopBarSection>
        <span className="mr-2 text-sm font-semibold text-text">Edit</span>
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
      </TopBarSection>

      <TopBarSection align="center">
        <span className="mr-2 hidden text-xs text-text-faint lg:inline">{active.hint}</span>
        <IconButton icon={<Type />} label="Edit text" variant={tool === "text" ? "active" : "default"} onClick={() => setEditTool("text")} />
        <IconButton
          icon={<ImageIcon />}
          label="Replace image"
          variant={tool === "image" ? "active" : "default"}
          onClick={() => setEditTool("image")}
        />
      </TopBarSection>

      <TopBarSection align="end">
        <IconButton icon={<X />} label="Exit edit mode" onClick={() => setEditOpen(false)} showTooltip={false} />
      </TopBarSection>
    </TopBar>
  );
}
