import { Button, Separator, TopBar, TopBarSection, toast } from "@pdfloom/ui";
import { useLoomStore } from "../../app/store";
import { PageNumberField } from "../viewer/PageNumberField";
import { ZoomControls } from "../viewer/ZoomControls";

export function FormsToolbar() {
  const setFormFillOpen = useLoomStore((s) => s.setFormFillOpen);
  const saveFormValues = useLoomStore((s) => s.saveFormValues);
  const isSavingForm = useLoomStore((s) => s.isSavingForm);
  const formFields = useLoomStore((s) => s.formFields);
  const fieldCount = new Set(formFields.map((f) => f.name)).size;

  const handleSave = async (flatten: boolean) => {
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
        <span className="mr-2 text-sm font-semibold text-text">Fill form</span>
        <PageNumberField />
        <Separator orientation="vertical" className="mx-1.5 h-6" />
        <ZoomControls />
      </TopBarSection>

      <TopBarSection align="center">
        <span className="text-xs text-text-faint">
          {fieldCount === 0 ? "This document has no fillable fields." : `${fieldCount} field${fieldCount === 1 ? "" : "s"} detected`}
        </span>
      </TopBarSection>

      <TopBarSection align="end">
        <Button variant="secondary" size="sm" onClick={() => void setFormFillOpen(false)}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" disabled={isSavingForm} onClick={() => void handleSave(false)}>
          {isSavingForm ? "Saving…" : "Save"}
        </Button>
        <Button variant="primary" size="sm" disabled={isSavingForm} onClick={() => void handleSave(true)}>
          {isSavingForm ? "Saving…" : "Save & flatten"}
        </Button>
      </TopBarSection>
    </TopBar>
  );
}
