import { useEffect, useRef, useState } from "react";
import { thumbnailUrl, type ReferenceImage } from "@renvia/types";
import { ApiError, useApiClient } from "../../lib/apiClient";
import { reportLimit } from "../../lib/useLimitDialog";
import { viewImage } from "../../canvas/utils/viewImage";
import { useElevationUpload } from "../../canvas/hooks/useElevationUpload";
import { ReferenceModal } from "./ReferenceModal";
import { SamplesDialog } from "./SamplesDialog";

type Panel = "library" | "samples" | "more" | null;

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

interface ReferenceBarProps {
  /** Attached reference URLs; the caller's store is the source of truth. */
  urls: string[];
  onChange: (urls: string[]) => void;
  maxReferences: number;
  /** Shown on the actions once the limit is reached. */
  atCapHint?: string;
  /** Offer sample designs (to start an elevation from) in Samples. Off where only references apply. */
  allowDesigns?: boolean;
}

export function ReferenceBar({ urls: attachedUrls, onChange, maxReferences, atCapHint, allowDesigns = true }: ReferenceBarProps) {
  const apiClient = useApiClient();
  const { placeSampleDesign } = useElevationUpload();
  // Attaching happens after an await, so read the latest list rather than this render's.
  const urlsRef = useRef(attachedUrls);
  urlsRef.current = attachedUrls;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openPanel, setOpenPanel] = useState<Panel>(null);

  const [library, setLibrary] = useState<ReferenceImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [isUploading, setIsUploading] = useState(false);

  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);

  useEffect(() => {
    if (!openPanel || openPanel === "samples") return; // the Samples popup closes itself on Escape
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openPanel]);

  const attach = ({ url }: { url: string }) => {
    const current = urlsRef.current;
    if (current.includes(url) || current.length >= maxReferences) return;
    onChange([...current, url]);
  };

  const detach = (url: string) => {
    onChange(urlsRef.current.filter((item) => item !== url));
  };

  // The person's own saved images. A failed load leaves it empty; reopening retries it.
  const loadLibrary = async () => {
    if (libraryLoaded || libraryLoading) return;
    setLibraryLoading(true);
    try {
      const own = await apiClient.listReferences();
      setLibrary(own.references);
      setLibraryLoaded(true);
    } catch {
      // shown as an empty library
    } finally {
      setLibraryLoading(false);
    }
  };

  const openPanelSafe = (panel: Exclude<Panel, null>) => {
    setOpenPanel(panel);
    if (panel === "library") void loadLibrary();
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (file: File) => {
    setIsUploading(true);
    try {
      const { publicUrl } = await apiClient.uploadImage(file);
      const reference = await apiClient.createReference({ url: publicUrl, source: "upload" });
      setLibrary((current) => [reference, ...current]);
      setLibraryLoaded(true);
      attach(reference);
    } catch (error) {
      // A limit refusal explains itself in the shared dialog; anything else just restores idle.
      reportLimit(error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddPastedUrl = async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    setIsPasting(true);
    setPasteError(null);
    try {
      const reference = await apiClient.createReference({ url, source: "url" });
      setLibrary((current) => [reference, ...current]);
      setLibraryLoaded(true);
      attach(reference);
      setPasteUrl("");
      setOpenPanel(null);
    } catch (error) {
      // The server explains why a link couldn't be imported (a page with no image, a blocked site…).
      setPasteError(
        error instanceof ApiError && error.status === 422 && error.detail
          ? error.detail
          : "Couldn't add that link. Check the URL and try again.",
      );
    } finally {
      setIsPasting(false);
    }
  };

  const atCap = attachedUrls.length >= maxReferences;
  const capHint = atCapHint ?? `Remove one first — up to ${maxReferences} references per render`;
  // Samples still opens at the cap when it can offer designs; only references are held back.
  const samplesBlocked = atCap && !allowDesigns;

  return (
    <>
      <div className="reference-bar">
        {attachedUrls.length > 0 && (
          <div className="reference-attached">
            <span className="reference-attached-count">
              {attachedUrls.length}/{maxReferences}
            </span>
            {attachedUrls.map((url) => (
              <div key={url} className="reference-attached-thumb">
                <button
                  type="button"
                  className="reference-attached-open"
                  title="View this reference full size"
                  onClick={() => viewImage(url, "Reference image")}
                >
                  <img src={thumbnailUrl(url)} alt="" />
                </button>
                <button type="button" onClick={() => detach(url)} aria-label="Remove reference">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="reference-actions" role="group" aria-label="Add reference images">
          <button
            type="button"
            className="reference-action"
            onClick={handleUploadClick}
            disabled={isUploading || atCap}
            title={atCap ? capHint : undefined}
          >
            <span className="reference-action-icon" aria-hidden="true">
              {isUploading ? (
                <Spinner size={15} />
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                  <circle cx="6" cy="7" r="1" stroke="currentColor" strokeWidth="1" />
                  <path d="M2.5 11.5 6 8.5l2.5 2.5 2-2 3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10.5 2.5h3v3M13.5 2.5 11 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <span className="reference-action-label">{isUploading ? "Uploading…" : "Upload"}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleFileSelected(file);
            }}
          />

          <button
            type="button"
            className={`reference-action ${openPanel === "library" ? "is-active" : ""}`}
            onClick={() => openPanelSafe("library")}
            aria-pressed={openPanel === "library"}
            disabled={atCap}
            title={atCap ? capHint : "Images you have saved before"}
          >
            <span className="reference-action-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M4 2.5h6l2 2v9H4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M6.5 6h3M6.5 8.5h3M6.5 11h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
            </span>
            <span className="reference-action-label">Library</span>
          </button>

          <button
            type="button"
            className={`reference-action ${openPanel === "more" ? "is-active" : ""}`}
            onClick={() => openPanelSafe("more")}
            aria-pressed={openPanel === "more"}
            disabled={atCap}
            title={atCap ? capHint : undefined}
          >
            <span className="reference-action-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2.5 8h11M8 2.5c1.5 1.6 2.3 3.5 2.3 5.5S9.5 11.9 8 13.5c-1.5-1.6-2.3-3.5-2.3-5.5S6.5 4.1 8 2.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="reference-action-label">Browse</span>
          </button>

          <button
            type="button"
            className={`reference-action ${openPanel === "samples" ? "is-active" : ""}`}
            onClick={() => openPanelSafe("samples")}
            aria-pressed={openPanel === "samples"}
            disabled={samplesBlocked}
            title={samplesBlocked ? capHint : "Ready-made references and designs from the Ramah Studio team"}
            data-guide="control.samples"
          >
            <span className="reference-action-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M8 1.8 9.4 5.6 13.2 7 9.4 8.4 8 12.2 6.6 8.4 2.8 7l3.8-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M12.5 11.5v3M11 13h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            </span>
            <span className="reference-action-label">Samples</span>
          </button>
        </div>
      </div>

      {openPanel === "samples" && (
        <SamplesDialog
          mode={allowDesigns ? "all" : "references"}
          referencesFull={atCap}
          onClose={() => setOpenPanel(null)}
          onPickReference={(sample) => {
            attach(sample);
            setOpenPanel(null);
          }}
          onPickDesign={(sample) => {
            setOpenPanel(null);
            void placeSampleDesign(sample);
          }}
        />
      )}

      {openPanel === "library" && (
        <ReferenceModal title="Your library" titleId="reference-library-title" onClose={() => setOpenPanel(null)} wide>
          {libraryLoading ? (
            <p className="reference-modal-empty">Loading your references…</p>
          ) : library.length === 0 ? (
            <div className="reference-modal-blank">
              <div className="reference-modal-blank-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                  <path d="M4 2.5h6l2 2v9H4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M6.5 6h3M6.5 8.5h3M6.5 11h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                </svg>
              </div>
              <p className="reference-modal-blank-title">Your library is empty</p>
              <p className="reference-modal-blank-copy">
                Upload an image or add one from a link — everything you save shows up here so you don&apos;t have to
                upload it again. Or start with one of our Samples.
              </p>
            </div>
          ) : (
            <div className="reference-image-grid">
              {library.map((reference) => (
                <button
                  key={reference.id}
                  type="button"
                  onClick={() => {
                    attach(reference);
                    setOpenPanel(null);
                  }}
                  className="reference-image-tile"
                >
                  <img src={thumbnailUrl(reference.url)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </ReferenceModal>
      )}

      {openPanel === "more" && (
        <ReferenceModal title="Browse other sites" titleId="reference-more-title" onClose={() => setOpenPanel(null)}>
          <p className="reference-modal-lead">
            Open Pinterest or Google Images in a new tab, find an image, then paste its link below. A page link works too; we pick up its main image.
          </p>

          <div className="reference-source-list">
            <a
              href="https://www.pinterest.com/search/pins/?q=modern%20house%20elevation"
              target="_blank"
              rel="noreferrer"
              className="reference-source-card"
            >
              <span className="reference-source-mark is-pinterest" aria-hidden="true">
                P
              </span>
              <span>
                <strong>Pinterest</strong>
                <small>Search pins for materials, facades, and mood</small>
              </span>
              <svg width="14" height="14" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M2 9 9 2M4 2h5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>

            <a
              href="https://www.google.com/search?tbm=isch&q=modern%20house%20elevation"
              target="_blank"
              rel="noreferrer"
              className="reference-source-card"
            >
              <span className="reference-source-mark is-google" aria-hidden="true">
                G
              </span>
              <span>
                <strong>Google Images</strong>
                <small>Broad web image search for architecture references</small>
              </span>
              <svg width="14" height="14" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M2 9 9 2M4 2h5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>

          <div className="reference-paste-block">
            <label htmlFor="reference-paste-url">Paste image URL</label>
            <div className="reference-search-row">
              <input
                id="reference-paste-url"
                value={pasteUrl}
                onChange={(event) => {
                  setPasteUrl(event.target.value);
                  setPasteError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleAddPastedUrl();
                }}
                placeholder="https://…"
                className="reference-search-input"
              />
              <button
                type="button"
                onClick={() => void handleAddPastedUrl()}
                disabled={isPasting || !pasteUrl.trim()}
                className="reference-search-submit"
              >
                {isPasting ? "Adding…" : "Add"}
              </button>
            </div>
            {pasteError && <p className="reference-modal-error">{pasteError}</p>}
          </div>
        </ReferenceModal>
      )}
    </>
  );
}
