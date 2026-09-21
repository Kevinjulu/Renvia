/**
 * The parts of a building people ask to change. Picking one here is the same automatic
 * selection the Auto tool runs, with a term written for the segmentation model rather than
 * left to the user's phrasing — "windows" finds every window, "make the windows black
 * aluminium" finds none.
 */
export interface EditPart {
  id: string;
  label: string;
  /** What the segmentation model is asked to find. */
  term: string;
}

/** Selects nothing: the edit applies to the whole image. */
export const WHOLE_IMAGE = "whole";

export const EDIT_PARTS: EditPart[] = [
  { id: "windows", label: "Windows", term: "windows" },
  { id: "doors", label: "Doors", term: "doors" },
  { id: "roof", label: "Roof", term: "roof" },
  { id: "walls", label: "Walls", term: "exterior walls and facade cladding" },
  { id: "balconies", label: "Balconies", term: "balconies and railings" },
  { id: "columns", label: "Columns", term: "columns and pillars" },
  { id: "garage", label: "Garage", term: "garage door" },
  { id: "fence", label: "Fence", term: "fence, wall and gate" },
  { id: "landscaping", label: "Landscaping", term: "plants, trees, grass and paving" },
  { id: "sky", label: "Sky", term: "sky" },
];

export function editPartById(id: string | null): EditPart | null {
  if (!id || id === WHOLE_IMAGE) return null;
  return EDIT_PARTS.find((part) => part.id === id) ?? null;
}
