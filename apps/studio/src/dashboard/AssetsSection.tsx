import { useEffect, useRef, useState } from "react";
import type { ReferenceImage, ReferenceImageSource } from "@renvia/types";
import { useApiClient } from "../lib/apiClient";
import { formatRelativeTime } from "../lib/relativeTime";

type Filter = "all" | ReferenceImageSource;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "upload", label: "Uploads" },
  { id: "unsplash", label: "Unsplash" },
  { id: "url", label: "Links" },
];

const SOURCE_LABEL: Record<ReferenceImageSource, string> = {
  upload: "Uploaded",
  unsplash: "Unsplash",
  url: "From a link",
};

function SourceBadge({ source }: { source: ReferenceImageSource }) {
  return <span className={`asset-badge is-${source}`}>{SOURCE_LABEL[source]}</span>;
}

interface AssetsSectionProps {
  autoOpenUpload?: boolean;
  onNotice: (message: string) => void;
}

/** The dashboard's browsable, manageable view of the same reference-image library the Studio's ReferenceBar attaches from. */
export function AssetsSection({ autoOpenUpload, onNotice }: AssetsSectionProps) {
  const api = useApiClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assets, setAssets] = useState<ReferenceImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadCount, setUploadCount] = useState<{ done: number; total: number } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listReferences()
      .then(({ references }) => {
        if (!cancelled) setAssets(references);
      })
      .catch(() => {
        if (!cancelled) onNotice("Couldn't load your assets. Try reloading the page.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoOpenUpload) fileInputRef.current?.click();
  }, [autoOpenUpload]);

  const counts = {
    all: assets.length,
    upload: assets.filter((asset) => asset.source === "upload").length,
    unsplash: assets.filter((asset) => asset.source === "unsplash").length,
    url: assets.filter((asset) => asset.source === "url").length,
  };
  const visible = filter === "all" ? assets : assets.filter((asset) => asset.source === filter);

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploadCount({ done: 0, total: files.length });
    let uploaded = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const { publicUrl } = await api.uploadImage(file);
        const reference = await api.createReference({ url: publicUrl, source: "upload" });
        setAssets((current) => [reference, ...current]);
        uploaded += 1;
      } catch {
        failed += 1;
      } finally {
        setUploadCount((current) => (current ? { done: current.done + 1, total: current.total } : current));
      }
    }
    setUploadCount(null);
    if (failed === 0) onNotice(`${uploaded} ${uploaded === 1 ? "file" : "files"} added to your assets.`);
    else onNotice(`${uploaded} of ${files.length} files added — ${failed} failed. Check the file type and try again.`);
  };

  const handleAddPastedUrl = async () => {
    const url = pasteUrl.trim();
    if (!url) return;
    setIsPasting(true);
    setPasteError(null);
    try {
      const reference = await api.createReference({ url, source: "url" });
      setAssets((current) => [reference, ...current]);
      setPasteUrl("");
      onNotice("Link added to your assets.");
    } catch {
      setPasteError("Couldn't add that link. Check the URL and try again.");
    } finally {
      setIsPasting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteReference(id);
      setAssets((current) => current.filter((asset) => asset.id !== id));
      onNotice("Asset removed.");
    } catch {
      onNotice("Couldn't remove that asset. Try again.");
    } finally {
      setDeletingId(null);
      setConfirmingId(null);
    }
  };

  return (
    <div className="assets-page">
      <div
        className={`assets-dropzone ${isDragOver ? "is-over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          void uploadFiles(Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/")));
        }}
      >
        <div>
          <strong>{isDragOver ? "Drop to upload" : "Drag images here, or"}</strong>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadCount !== null}>
            {uploadCount ? `Uploading ${uploadCount.done}/${uploadCount.total}…` : "Choose files"}
          </button>
        </div>
        <small>PNG, JPG, or WEBP — saved to your library and reusable as a reference in any project</small>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void uploadFiles(files);
          }}
        />
      </div>

      <div className="assets-paste">
        <label htmlFor="assets-paste-url">Or add from a link</label>
        <div className="assets-paste-row">
          <input
            id="assets-paste-url"
            value={pasteUrl}
            onChange={(event) => {
              setPasteUrl(event.target.value);
              setPasteError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleAddPastedUrl();
            }}
            placeholder="https://…"
          />
          <button type="button" onClick={() => void handleAddPastedUrl()} disabled={isPasting || !pasteUrl.trim()}>
            {isPasting ? "Adding…" : "Add"}
          </button>
        </div>
        {pasteError && <p className="assets-paste-error">{pasteError}</p>}
      </div>

      <div className="assets-toolbar">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "is-active" : ""}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <span>{counts[item.id]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="assets-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="asset-tile is-skeleton" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="assets-empty">
          <p className="assets-empty-title">{filter === "all" ? "No assets yet" : `No ${FILTERS.find((item) => item.id === filter)!.label.toLowerCase()} yet`}</p>
          <p>Upload a file above, or paste a link, and it'll show up here — ready to attach as a reference in any project.</p>
        </div>
      ) : (
        <div className="assets-grid">
          {visible.map((asset) => (
            <figure key={asset.id} className="asset-tile">
              <a href={asset.url} target="_blank" rel="noreferrer" className="asset-tile-image">
                <img src={asset.url} alt="" loading="lazy" />
              </a>
              <figcaption>
                <SourceBadge source={asset.source} />
                <small>{formatRelativeTime(asset.createdAt)}</small>
              </figcaption>
              {confirmingId === asset.id ? (
                <div className="asset-tile-confirm">
                  <p>Remove this asset?</p>
                  <div>
                    <button type="button" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                    <button type="button" className="is-danger" disabled={deletingId === asset.id} onClick={() => void handleDelete(asset.id)}>
                      {deletingId === asset.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="asset-tile-delete" aria-label="Remove asset" onClick={() => setConfirmingId(asset.id)}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3.5 4.5h9M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6.5 7.5v4M9.5 7.5v4M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
