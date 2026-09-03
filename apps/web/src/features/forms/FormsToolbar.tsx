import { IconButton, Separator, TopBar, TopBarSection, Button as ToolbarButton, cn, toast } from "@pdfloom/ui";
import { CheckSquare, ChevronDown, Circle, Type } from "lucide-react";
import type { ReactNode } from "react";
import { useLoomStore, type FieldDesignTool } from "../../app/store";
import { PageNumberField } from "../viewer/PageNumberField";
import { ZoomControls } from "../viewer/ZoomControls";
import { getMissingRequiredFields } from "./validation";

const DESIGN_TOOLS: { id: FieldDesignTool; label: string; icon: ReactNode }[] = [
  { id: "text", label: "Text field", icon: <Type /> },
  { id: "checkbox", label: "Checkbox", icon: <CheckSquare /> },
  { id: "radio", label: "Radio button", icon: <Circle /> },
  { id: "dropdown", label: "Dropdown", icon: <ChevronDown /> },
];

export function FormsToolbar() {
  const setFormFillOpen = useLoomStore((s) => s.setFormFillOpen);
  const saveFormValues = useLoomStore((s) => s.saveFormValues);
  const isSavingForm = useLoomStore((s) => s.isSavingForm);
  const formFields = useLoomStore((s) => s.formFields);
  const formFieldValues = useLoomStore((s) => s.formFieldValues);
  const formMode = useLoomStore((s) => s.formMode);
  const setFormMode = useLoomStore((s) => s.setFormMode);
  const designTool = useLoomStore((s) => s.formDesignTool);
  const setFormDesignTool = useLoomStore((s) => s.setFormDesignTool);
  const fieldCount = new Set(formFields.map((f) => f.name)).size;

  const describeMissing = (missing: ReturnType<typeof getMissingRequiredFields>) => {
    const names = missing.slice(0, 5).map((f) => f.name);
    const suffix = missing.length > 5 ? `, and ${missing.length - 5} more` : "";
    return `${names.join(", ")}${suffix}`;
  };

  const handleSave = async (flatten: boolean) => {
    const missing = getMissingRequiredFields(formFields, formFieldValues);
    if (missing.length > 0) {
      if (flatten) {
        // Flattening bakes values in and removes the fields — blocked
        // outright, since there'd be no way to go back and fill a required
        // field in afterward. A plain (non-flattened) save is left as a
        // draft-in-progress use case instead — warned, not blocked, since
        // someone filling this out over multiple sessions still needs to
        // be able to save partial progress.
        toast.error(`${missing.length} required field${missing.length === 1 ? "" : "s"} still empty`, `${describeMissing(missing)} — fill these in before saving & flattening, or use plain Save to keep working on it later.`);
        return;
      }
      toast.warning(`${missing.length} required field${missing.length === 1 ? "" : "s"} still empty`, describeMissing(missing));
    }
    try {
      await saveFormValues(flatten);
      toast.success(flatten ? "Form saved and flattened" : "Form saved");
    } catch (error) {
      toast.error("Couldn't save the form", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <TopBar>
      <TopBarSection>
        <span className="mr-2 text-sm font-semibold text-text">Forms</span>
        <div className="flex items-center rounded-[--radius-sm] border border-border-strong p-0.5">
          <button
            type="button"
            onClick={() => setFormMode("fill")}
            className={cn(
              "rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors",
              formMode === "fill" ? "bg-primary text-primary-text" : "text-text-faint hover:text-text",
            )}
          >
            Fill
          </button>
          <button
            type="button"
            onClick={() => setFormMode("design")}
            className={cn(
              "rounded-[3px] px-2.5 py-1 text-xs font-medium transition-colors",
              formMode === "design" ? "bg-primary text-primary-text" : "text-text-faint hover:text-text",
            )}
          >
            Add fields
          </button>
        </div>
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
      </TopBarSection>

      <TopBarSection align="center">
        {formMode === "design" ? (
          <>
            <span className="mr-2 hidden text-xs text-text-faint lg:inline">Click the page to place a field</span>
            {DESIGN_TOOLS.map((t) => (
              <IconButton
                key={t.id}
                icon={t.icon}
                label={t.label}
                variant={designTool === t.id ? "active" : "default"}
                onClick={() => setFormDesignTool(t.id)}
              />
            ))}
          </>
        ) : (
          <span className="text-xs text-text-faint">
            {fieldCount === 0 ? "This document has no fillable fields." : `${fieldCount} field${fieldCount === 1 ? "" : "s"} detected`}
          </span>
        )}
      </TopBarSection>

      <TopBarSection align="end">
        <ToolbarButton variant="secondary" size="sm" onClick={() => void setFormFillOpen(false)}>
          Cancel
        </ToolbarButton>
        <ToolbarButton variant="secondary" size="sm" disabled={isSavingForm} onClick={() => void handleSave(false)}>
          {isSavingForm ? "Saving…" : "Save"}
        </ToolbarButton>
        <ToolbarButton variant="primary" size="sm" disabled={isSavingForm} onClick={() => void handleSave(true)}>
          {isSavingForm ? "Saving…" : "Save & flatten"}
        </ToolbarButton>
      </TopBarSection>
    </TopBar>
  );
}
