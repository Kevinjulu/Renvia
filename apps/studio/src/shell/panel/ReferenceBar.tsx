import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReferenceImage } from "@renvia/types";
import { useApiClient } from "../../lib/apiClient";
import { reportLimit } from "../../lib/useLimitDialog";
import { useGenerationSettingsStore } from "../../canvas/hooks/useGenerationSettingsStore";
import { isUnsplashConfigured, searchUnsplash, type UnsplashPhoto } from "../../lib/unsplash";
import { viewImage } from "../../canvas/utils/viewImage";

type Panel = "library" | "unsplash" | "more" | null;

/** Matches the API's per-render reference limit. */
const MAX_REFERENCES = 8;

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReferenceModal({
  title,
  titleId,
  children,
  onClose,
  wide,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="reference-modal-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`reference-modal ${wide ? "is-wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reference-modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="reference-modal-close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="m2 2 8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="reference-modal-body">{children}</div>
      </div>
    </div>
  );
}

export function ReferenceBar() {
  const apiClient = useApiClient();
  // The store is the source of truth, so the Render and Edit tabs share one attachment
  // list and restoring a previous render's settings shows its references here.
  const attachedUrls = useGenerationSettingsStore((state) => state.referenceImageUrls);
  const setReferenceImageUrls = useGenerationSettingsStore((state) => state.setReferenceImageUrls);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openPanel, setOpenPanel] = useState<Panel>(null);

  const [library, setLibrary] = useState<ReferenceImage[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [isUploading, setIsUploading] = useState(false);

  const [unsplashQuery, setUnsplashQuery] = useState("");
  const [unsplashResults, setUnsplashResults] = useState<UnsplashPhoto[]>([]);
  const [unsplashLoading, setUnsplashLoading] = useState(false);
  const [unsplashError, setUnsplashError] = useState<string | null>(null);
  const [savingPhotoId, setSavingPhotoId] = useState<string | null>(null);

  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);

  useEffect(() => {
    if (!openPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openPanel]);

  const attach = (reference: ReferenceImage) => {
    const current = useGenerationSettingsStore.getState().referenceImageUrls;
    if (current.includes(reference.url) || current.length >= MAX_REFERENCES) return;
    setReferenceImageUrls([...current, reference.url]);
  };

  const detach = (url: string) => {
    setReferenceImageUrls(useGenerationSettingsStore.getState().referenceImageUrls.filter((item) => item !== url));
  };

  const loadLibrary = async () => {
    if (libraryLoaded || libraryLoading) return;
    setLibraryLoading(true);
    try {
      const { references } = await apiClient.listReferences();
      setLibrary(references);
      setLibraryLoaded(true);
    } catch {
      // Leave empty; reopen retries.
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

  const runUnsplashSearch = async () => {
    if (!unsplashQuery.trim()) return;
    setUnsplashLoading(true);
    setUnsplashError(null);
    try {
      const results = await searchUnsplash(unsplashQuery.trim());
      setUnsplashResults(results);
    } catch {
      setUnsplashError("Couldn't reach Unsplash. Check your connection and try again.");
    } finally {
      setUnsplashLoading(false);
    }
  };

  const handlePickUnsplashPhoto = async (photo: UnsplashPhoto) => {
    setSavingPhotoId(photo.id);
    try {
      const reference = await apiClient.createReference({ url: photo.fullUrl, source: "unsplash" });
      setLibrary((current) => [reference, ...current]);
      setLibraryLoaded(true);
      attach(reference);
      setOpenPanel(null);
    } catch {
      // Keep open for retry.
    } finally {
      setSavingPhotoId(null);
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
    } catch {
      setPasteError("Couldn't save that link. Check the URL and try again.");
    } finally {
      setIsPasting(false);
    }
  };

  return (
    <>
      <div className="reference-bar">
        {attachedUrls.length > 0 && (
          <div className="reference-attached">
            {attachedUrls.map((url) => (
              <div key={url} className="reference-attached-thumb">
                <button
                  type="button"
                  className="reference-attached-open"
                  title="View this reference full size"
                  onClick={() => viewImage(url, "Reference image")}
                >
                  <img src={url} alt="" />
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
            disabled={isUploading}
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
            className={`reference-action ${openPanel === "unsplash" ? "is-active" : ""}`}
            onClick={() => openPanelSafe("unsplash")}
            aria-pressed={openPanel === "unsplash"}
          >
            <span className="reference-action-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2.5 12 6 7.5l2 2.2L11 6l2.5 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="6" cy="5.8" r="0.9" stroke="currentColor" strokeWidth="1" />
              </svg>
            </span>
            <span className="reference-action-label">Unsplash</span>
          </button>

          <button
            type="button"
            className={`reference-action ${openPanel === "more" ? "is-active" : ""}`}
            onClick={() => openPanelSafe("more")}
            aria-pressed={openPanel === "more"}
          >
            <span className="reference-action-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M2.5 8h11M8 2.5c1.5 1.6 2.3 3.5 2.3 5.5S9.5 11.9 8 13.5c-1.5-1.6-2.3-3.5-2.3-5.5S6.5 4.1 8 2.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="reference-action-label">Browse</span>
          </button>
        </div>
      </div>

      {openPanel === "library" && (
        <ReferenceModal title="Reference library" titleId="reference-library-title" onClose={() => setOpenPanel(null)} wide>
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
                Upload an image or pick one from Unsplash — everything you save shows up here so you don&apos;t have to
                upload it again.
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
                  <img src={reference.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </ReferenceModal>
      )}

      {openPanel === "unsplash" && (
        <ReferenceModal title="Search Unsplash" titleId="reference-unsplash-title" onClose={() => setOpenPanel(null)} wide>
          {isUnsplashConfigured() ? (
            <>
              <div className="reference-search-row">
                <input
                  value={unsplashQuery}
                  onChange={(event) => setUnsplashQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runUnsplashSearch();
                  }}
                  placeholder="Search materials, lighting, landscapes…"
                  autoFocus
                  className="reference-search-input"
                />
                <button
                  type="button"
                  onClick={() => void runUnsplashSearch()}
                  disabled={unsplashLoading || !unsplashQuery.trim()}
                  className="reference-search-submit"
                >
                  {unsplashLoading ? "Searching…" : "Search"}
                </button>
              </div>

              {unsplashError && <p className="reference-modal-error">{unsplashError}</p>}

              {!unsplashLoading && !unsplashError && unsplashResults.length === 0 && (
                <div className="reference-modal-blank">
                  <p className="reference-modal-blank-title">Find reference photos</p>
                  <p className="reference-modal-blank-copy">
                    Search Unsplash for finishes, context, or atmosphere. Click a photo to attach it to this render.
                  </p>
                </div>
              )}

              {unsplashResults.length > 0 && (
                <div className="reference-image-grid is-dense">
                  {unsplashResults.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => void handlePickUnsplashPhoto(photo)}
                      disabled={savingPhotoId === photo.id}
                      className="reference-image-tile"
                      title={photo.alt || "Use this photo"}
                    >
                      <img src={photo.thumbUrl} alt={photo.alt} />
                      {savingPhotoId === photo.id && (
                        <span className="reference-image-busy">
                          <Spinner size={18} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              <p className="reference-modal-footnote">Photos via Unsplash. Requires an internet connection.</p>
            </>
          ) : (
            <div className="reference-modal-blank">
              <p className="reference-modal-blank-title">Unsplash isn&apos;t configured</p>
              <p className="reference-modal-blank-copy">
                Add an Unsplash access key to enable in-app photo search. You can still upload files or browse other
                sites.
              </p>
            </div>
          )}
        </ReferenceModal>
      )}

      {openPanel === "more" && (
        <ReferenceModal title="Browse other sites" titleId="reference-more-title" onClose={() => setOpenPanel(null)}>
          <p className="reference-modal-lead">
            Open Pinterest or Google Images in a new tab, then paste the image link below to attach it as a reference.
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
