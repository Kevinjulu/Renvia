import { useEffect, useRef, useState } from "react";
import type { ReferenceImage } from "@renvia/types";
import { useApiClient } from "../../lib/apiClient";
import { isUnsplashConfigured, searchUnsplash, type UnsplashPhoto } from "../../lib/unsplash";

type Panel = "library" | "unsplash" | "more" | null;

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ReferenceBar() {
  const apiClient = useApiClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [openPanel, setOpenPanel] = useState<Panel>(null);
  const [attached, setAttached] = useState<ReferenceImage[]>([]);

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

  useEffect(() => {
    if (!openPanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openPanel]);

  const attach = (reference: ReferenceImage) => {
    setAttached((current) => (current.some((item) => item.id === reference.id) ? current : [...current, reference]));
  };

  const detach = (id: string) => {
    setAttached((current) => current.filter((item) => item.id !== id));
  };

  const loadLibrary = async () => {
    if (libraryLoaded || libraryLoading) return;
    setLibraryLoading(true);
    try {
      const { references } = await apiClient.listReferences();
      setLibrary(references);
      setLibraryLoaded(true);
    } catch {
      // Leave the panel empty; the user can retry by reopening it.
    } finally {
      setLibraryLoading(false);
    }
  };

  const togglePanel = (panel: Exclude<Panel, null>) => {
    setOpenPanel((current) => {
      const next = current === panel ? null : panel;
      if (next === "library") void loadLibrary();
      return next;
    });
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (file: File) => {
    setIsUploading(true);
    try {
      const { publicUrl } = await apiClient.uploadImage(file);
      const reference = await apiClient.createReference({ url: publicUrl, source: "upload" });
      setLibrary((current) => [reference, ...current]);
      attach(reference);
    } catch {
      // Silently ignore for now; the icon returns to its idle state either way.
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
      attach(reference);
      setOpenPanel(null);
    } catch {
      // Keep the panel open so the user can retry.
    } finally {
      setSavingPhotoId(null);
    }
  };

  const handleAddPastedUrl = async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    try {
      const reference = await apiClient.createReference({ url, source: "url" });
      setLibrary((current) => [reference, ...current]);
      attach(reference);
      setPasteUrl("");
      setOpenPanel(null);
    } catch {
      // Leave the input filled so the user can adjust and retry.
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {attached.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attached.map((reference) => (
            <div key={reference.id} className="group relative">
              <img src={reference.url} alt="" className="h-10 w-10 rounded-md object-cover" />
              <button
                type="button"
                onClick={() => detach(reference.id)}
                aria-label="Remove reference"
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-secondary opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:text-primary"
              >
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="m2 2 6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 text-faint">
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={isUploading}
          title="Upload reference image"
          aria-label="Upload reference image"
          className="transition-colors hover:text-primary disabled:cursor-wait"
        >
          {isUploading ? (
            <Spinner />
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2" y="3" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="6" cy="7" r="1" stroke="currentColor" strokeWidth="1" />
              <path d="M2.5 11.5 6 8.5l2.5 2.5 2-2 3 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10.5 2.5h3v3M13.5 2.5 11 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          )}
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
          onClick={() => togglePanel("library")}
          title="Reference library"
          aria-label="Reference library"
          aria-pressed={openPanel === "library"}
          className={`transition-colors hover:text-primary ${openPanel === "library" ? "text-blueprint" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 2.5h6l2 2v9H4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6.5 6h3M6.5 8.5h3M6.5 11h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => togglePanel("unsplash")}
          title="Search Unsplash"
          aria-label="Search Unsplash"
          aria-pressed={openPanel === "unsplash"}
          className={`transition-colors hover:text-primary ${openPanel === "unsplash" ? "text-blueprint" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.3" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2.5 12 6 7.5l2 2.2L11 6l2.5 4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="6" cy="5.8" r="0.9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => togglePanel("more")}
          title="More reference sources"
          aria-label="More reference sources"
          aria-pressed={openPanel === "more"}
          className={`transition-colors hover:text-primary ${openPanel === "more" ? "text-blueprint" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2.5 8h11M8 2.5c1.5 1.6 2.3 3.5 2.3 5.5S9.5 11.9 8 13.5c-1.5-1.6-2.3-3.5-2.3-5.5S6.5 4.1 8 2.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {openPanel === "library" && (
        <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-hairline bg-white p-3 shadow-lg">
          <p className="text-xs font-medium text-secondary">Your reference library</p>
          {libraryLoading ? (
            <p className="mt-3 text-xs text-muted">Loading…</p>
          ) : library.length === 0 ? (
            <p className="mt-3 text-xs text-muted">
              Nothing saved yet — uploads and images you pick from Unsplash or elsewhere will show up here.
            </p>
          ) : (
            <div className="mt-2 grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
              {library.map((reference) => (
                <button
                  key={reference.id}
                  type="button"
                  onClick={() => attach(reference)}
                  className="aspect-square overflow-hidden rounded-md border border-transparent hover:border-blueprint"
                >
                  <img src={reference.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {openPanel === "unsplash" && (
        <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-hairline bg-white p-3 shadow-lg">
          {isUnsplashConfigured() ? (
            <>
              <div className="flex gap-1.5">
                <input
                  value={unsplashQuery}
                  onChange={(event) => setUnsplashQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void runUnsplashSearch();
                  }}
                  placeholder="Search Unsplash photos…"
                  className="flex-1 rounded-md border border-hairline px-2 py-1.5 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void runUnsplashSearch()}
                  className="rounded-md bg-primary px-2.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Go
                </button>
              </div>
              {unsplashLoading && <p className="mt-3 text-xs text-muted">Searching…</p>}
              {unsplashError && <p className="mt-3 text-xs text-red-600">{unsplashError}</p>}
              {!unsplashLoading && !unsplashError && unsplashResults.length > 0 && (
                <div className="mt-2 grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
                  {unsplashResults.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => void handlePickUnsplashPhoto(photo)}
                      disabled={savingPhotoId === photo.id}
                      className="relative aspect-square overflow-hidden rounded-md border border-transparent hover:border-blueprint disabled:opacity-50"
                    >
                      <img src={photo.thumbUrl} alt={photo.alt} className="h-full w-full object-cover" />
                      {savingPhotoId === photo.id && (
                        <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-secondary">
                          <Spinner />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[10px] text-faint">Photos via Unsplash. Requires an internet connection.</p>
            </>
          ) : (
            <p className="text-xs text-muted">Unsplash search isn't configured yet.</p>
          )}
        </div>
      )}

      {openPanel === "more" && (
        <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-hairline bg-white p-3 shadow-lg">
          <p className="text-xs font-medium text-secondary">Browse another site</p>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            These sites can't be embedded here — search opens in a new tab, then paste the image link below to save it.
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <a
              href="https://www.pinterest.com/search/pins/?q=modern%20house%20elevation"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-md border border-hairline px-2.5 py-1.5 text-sm text-primary hover:border-hairline-strong"
            >
              Search Pinterest
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M2 9 9 2M4 2h5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="https://www.google.com/search?tbm=isch&q=modern%20house%20elevation"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-md border border-hairline px-2.5 py-1.5 text-sm text-primary hover:border-hairline-strong"
            >
              Search Google Images
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M2 9 9 2M4 2h5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
          <div className="mt-3 flex gap-1.5">
            <input
              value={pasteUrl}
              onChange={(event) => setPasteUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleAddPastedUrl();
              }}
              placeholder="Paste image URL…"
              className="flex-1 rounded-md border border-hairline px-2 py-1.5 text-sm text-primary placeholder:text-faint focus:border-blueprint focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleAddPastedUrl()}
              className="rounded-md bg-primary px-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
