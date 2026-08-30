import { useCallback, useRef, type ChangeEvent, type ReactElement } from "react";
import type { SourceImage } from "@pdfloom/core";

function imageTypeFromMime(mime: string): SourceImage["type"] | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return null;
}

/**
 * A hidden multi-file `<input>` plus an imperative `open()` trigger — lets a
 * DropdownMenu item or a plain button kick off a native image picker without
 * needing its own always-mounted `<input>` in the JSX tree at the call site.
 * Reads every chosen file into a SourceImage (skipping anything that isn't a
 * PNG/JPEG, since that's all pdf-lib can embed) before handing them to
 * `onImages`.
 */
export function useImageFilePicker(onImages: (images: SourceImage[]) => void): { open: () => void; input: ReactElement } {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = [...(e.target.files ?? [])];
      e.target.value = "";
      if (files.length === 0) return;
      const images: SourceImage[] = [];
      for (const file of files) {
        const type = imageTypeFromMime(file.type);
        if (!type) continue;
        images.push({ bytes: new Uint8Array(await file.arrayBuffer()), type });
      }
      if (images.length > 0) onImages(images);
    },
    [onImages],
  );

  const open = useCallback(() => inputRef.current?.click(), []);

  return {
    open,
    input: (
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" multiple className="hidden" onChange={(e) => void handleChange(e)} />
    ),
  };
}
