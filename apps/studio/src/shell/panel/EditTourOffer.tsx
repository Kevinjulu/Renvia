import { useState } from "react";
import { editTourSeen, startEditTour } from "../../guide/editTour";
import { markTourFinished } from "../../guide/persistence";
import { useGuideStore } from "../../guide/useGuideStore";

/**
 * A one-time offer at the top of the Edit panel: a 30-second tour of how to make a good edit.
 * Taking, skipping or dismissing the tour all count as seen, so it never comes back.
 */
export function EditTourOffer() {
  const touring = useGuideStore((state) => state.mode === "tour");
  const [, refresh] = useState(0);
  if (touring || editTourSeen()) return null;

  return (
    <div className="cp-tour-offer" role="note">
      <div>
        <strong>New to editing?</strong>
        <span>Take a 30-second tour of how to make a good edit.</span>
      </div>
      <div className="cp-tour-offer-actions">
        <button type="button" onClick={() => startEditTour()}>
          Show me
        </button>
        <button
          type="button"
          aria-label="Dismiss the edit tour offer"
          onClick={() => {
            markTourFinished("edit");
            refresh((count) => count + 1);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
