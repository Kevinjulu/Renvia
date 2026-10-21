import { useEffect, useMemo, useState } from "react";
import { DESIGN_CATEGORIES, REFERENCE_CATEGORIES, thumbnailUrl, type SampleCategory, type StockReference } from "@renvia/types";
import { ReferenceModal } from "./ReferenceModal";
import { useSamples } from "../../lib/useSamples";

type Section = "references" | "designs";

const SECTIONS: Record<Section, { label: string; categories: readonly { key: SampleCategory; label: string }[]; lead: string }> = {
  references: {
    label: "References",
    categories: REFERENCE_CATEGORIES,
    lead: "Picked by the Ramah Studio team. Click one to use it as a reference for this render.",
  },
  designs: {
    label: "Designs",
    categories: DESIGN_CATEGORIES,
    lead: "Original designs to start from: a 3D model (ArchiCAD or similar), a photo or a drawing. Click one to use it as your elevation.",
  },
};

interface SamplesDialogProps {
  /** "all" offers references and designs; "designs" picks an elevation only; "references" skips designs. */
  mode: "all" | "references" | "designs";
  onClose: () => void;
  onPickReference?: (sample: StockReference) => void;
  onPickDesign?: (sample: StockReference) => void;
  /** All reference slots are taken: references stay visible but can't be picked. */
  referencesFull?: boolean;
}

/** Sample references and sample designs, picked from a popup. */
export function SamplesDialog({ mode, onClose, onPickReference, onPickDesign, referencesFull = false }: SamplesDialogProps) {
  const { samples, status, retry } = useSamples();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const sectionsShown = useMemo(
    () =>
      (mode === "designs" ? (["designs"] as Section[]) : mode === "references" ? (["references"] as Section[]) : (["references", "designs"] as Section[])).filter((section) =>
        samples.some((sample) => SECTIONS[section].categories.some((category) => category.key === sample.category)),
      ),
    [mode, samples],
  );

  const [chosenSection, setChosenSection] = useState<Section | null>(mode === "designs" ? "designs" : null);
  const [chosenCategory, setChosenCategory] = useState<SampleCategory | null>(null);

  const section: Section | null = chosenSection && sectionsShown.includes(chosenSection) ? chosenSection : (sectionsShown[0] ?? null);
  const categories = section ? SECTIONS[section].categories.filter((category) => samples.some((sample) => sample.category === category.key)) : [];
  const category = categories.find((item) => item.key === chosenCategory) ?? categories[0] ?? null;
  const shown = category ? samples.filter((sample) => sample.category === category.key) : [];
  const isDesigns = section === "designs";
  const full = !isDesigns && referencesFull;

  return (
    <ReferenceModal title={mode === "designs" ? "Sample designs" : "Samples"} titleId="samples-title" onClose={onClose} wide>
      {status === "loading" || (status === "idle" && samples.length === 0) ? (
        <p className="reference-modal-empty">Loading samples…</p>
      ) : status === "error" && samples.length === 0 ? (
        <div className="reference-modal-blank">
          <p className="reference-modal-blank-title">Couldn&apos;t load the samples</p>
          <p className="reference-modal-blank-copy">Check your connection and try again.</p>
          <button type="button" className="reference-search-submit" onClick={() => void retry()}>
            Try again
          </button>
        </div>
      ) : !section ? (
        <div className="reference-modal-blank">
          <p className="reference-modal-blank-title">No samples yet</p>
          <p className="reference-modal-blank-copy">The team is still adding them. Upload your own image for now.</p>
        </div>
      ) : (
        <>
          {sectionsShown.length > 1 && (
            <div className="samples-sections" role="tablist" aria-label="Kind of sample">
              {sectionsShown.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={section === item}
                  className={section === item ? "is-active" : ""}
                  onClick={() => {
                    setChosenSection(item);
                    setChosenCategory(null);
                  }}
                >
                  {SECTIONS[item].label}
                </button>
              ))}
            </div>
          )}
          <div className="reference-library-tabs" role="tablist" aria-label={`${SECTIONS[section].label} categories`}>
            {categories.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={category?.key === item.key}
                className={`reference-library-tab ${category?.key === item.key ? "is-active" : ""}`}
                onClick={() => setChosenCategory(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="reference-modal-lead reference-library-lead">
            {full ? "All reference slots are in use. Remove one from the panel to add another." : SECTIONS[section].lead}
          </p>
          <div className={`reference-image-grid ${isDesigns ? "is-designs" : ""}`}>
            {shown.map((sample) => (
              <button
                key={sample.id}
                type="button"
                disabled={full}
                onClick={() => (isDesigns ? onPickDesign : onPickReference)?.(sample)}
                className="reference-image-tile"
                title={sample.caption ?? (isDesigns ? "Use this design" : "Use this sample")}
              >
                <img src={thumbnailUrl(sample.url)} alt={sample.caption ?? ""} loading="lazy" />
                {sample.caption && <span className="reference-image-caption">{sample.caption}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </ReferenceModal>
  );
}
