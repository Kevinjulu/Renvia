import { useEffect, useMemo, useRef, useState } from "react";
import { useDownloadDialogStore } from "./hooks/useDownloadDialogStore";
import { useRenderJobsStore } from "./hooks/useRenderJobsStore";

type Format = "jpeg" | "png" | "webp";
type Layout = "render" | "compare";

const FORMATS: { id: Format; label: string; hint: string; mime: string; ext: string }[] = [
  { id: "jpeg", label: "JPG", hint: "Smallest file, works everywhere", mime: "image/jpeg", ext: "jpg" },
  { id: "png", label: "PNG", hint: "Lossless — best for print and editing", mime: "image/png", ext: "png" },
  { id: "webp", label: "WebP", hint: "Small and sharp — for websites", mime: "image/webp", ext: "webp" },
];

/** Long-edge sizes offered below the original; the original itself is always first. */
const SIZE_PRESETS = [
  { edge: 1920, label: "Large", hint: "Presentations" },
  { edge: 1280, label: "Medium", hint: "Web and social" },
  { edge: 800, label: "Small", hint: "Email and chat" },
];

const LOSSY_QUALITY = 0.92;
const COMPARE_GAP = 16;

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadBitmap(url: string) {
  // Fetched rather than loaded through <img> so the pixels are CORS-clean for canvas export.
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
  const blob = await response.blob();
  return { blob, bitmap: await createImageBitmap(blob) };
}

function toBlob(canvas: HTMLCanvasElement, mime: string) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))), mime, LOSSY_QUALITY),
  );
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download options for a render, over a blurred studio. The AI returns one fixed size per
 * render, so "Original" is the ceiling — smaller sizes and other formats are made here.
 */
export function DownloadDialog() {
  const jobId = useDownloadDialogStore((state) => state.jobId);
  const close = useDownloadDialogStore((state) => state.close);
  const job = useRenderJobsStore((state) => state.jobs.find((item) => item.id === jobId) ?? null);
  const imageUrl = job?.resultImageUrl ?? job?.sourceImageUrl ?? null;

  const [render, setRender] = useState<{ blob: Blob; bitmap: ImageBitmap } | null>(null);
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [format, setFormat] = useState<Format>("jpeg");
  const [edge, setEdge] = useState<number | null>(null);
  const [layout, setLayout] = useState<Layout>("render");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);

  // Reset for each render opened.
  useEffect(() => {
    if (!job || !imageUrl) return;
    let cancelled = false;
    setRender(null);
    setSource(null);
    setLoadError(false);
    setEdge(null);
    setLayout("render");
    setNotice(null);
    setName(slug(["renvia", job.viewLabel ?? "render", job.settings?.edit ? "edit" : null, job.createdAt.slice(0, 10)].filter(Boolean).join(" ")));
    loadBitmap(imageUrl)
      .then((result) => !cancelled && setRender(result))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  useEffect(() => {
    if (!jobId) return;
    downloadRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [jobId, close]);

  // The source is only needed for the before/after layout.
  useEffect(() => {
    if (layout !== "compare" || source || !job) return;
    let cancelled = false;
    loadBitmap(job.sourceImageUrl)
      .then(({ bitmap }) => !cancelled && setSource(bitmap))
      .catch(() => !cancelled && setNotice("Couldn't load the source image for before & after."));
    return () => {
      cancelled = true;
    };
  }, [layout, source, job]);

  const original = useMemo(() => (render ? { width: render.bitmap.width, height: render.bitmap.height } : null), [render]);
  // Skip presets too close to the original to be worth offering.
  const sizes = original ? SIZE_PRESETS.filter((preset) => preset.edge < Math.max(original.width, original.height) * 0.85) : [];
  const formatSpec = FORMATS.find((item) => item.id === format)!;
  const compareReady = layout !== "compare" || Boolean(source);

  /** Draws the chosen layout at the chosen size. Returns null when the untouched original will do. */
  const compose = (): HTMLCanvasElement | null => {
    if (!render) return null;
    const scale = edge ? edge / Math.max(render.bitmap.width, render.bitmap.height) : 1;
    const width = Math.round(render.bitmap.width * scale);
    const height = Math.round(render.bitmap.height * scale);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";

    if (layout === "compare" && source) {
      const sourceWidth = Math.round((source.width / source.height) * height);
      canvas.width = sourceWidth + COMPARE_GAP + width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, sourceWidth, height);
      context.drawImage(render.bitmap, sourceWidth + COMPARE_GAP, 0, width, height);
      return canvas;
    }

    canvas.width = width;
    canvas.height = height;
    if (format === "jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(render.bitmap, 0, 0, width, height);
    return canvas;
  };

  /** The original bytes are passed through untouched when nothing about them changes. */
  const isPassThrough = Boolean(render && !edge && layout === "render" && render.blob.type === formatSpec.mime);

  const buildBlob = async () => {
    if (!render) throw new Error("Image not loaded");
    if (isPassThrough) return render.blob;
    const canvas = compose();
    if (!canvas) throw new Error("Canvas unavailable");
    return toBlob(canvas, formatSpec.mime);
  };

  // Live file-size estimate for the chosen options.
  useEffect(() => {
    if (!render || !compareReady) return;
    let cancelled = false;
    setEstimate(null);
    const timer = setTimeout(() => {
      buildBlob()
        .then((blob) => !cancelled && setEstimate(blob.size))
        .catch(() => !cancelled && setEstimate(null));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, format, edge, layout, compareReady]);

  if (!jobId || !job || !imageUrl) return null;

  const outputSize = (() => {
    if (!original) return null;
    const scale = edge ? edge / Math.max(original.width, original.height) : 1;
    const width = Math.round(original.width * scale);
    const height = Math.round(original.height * scale);
    if (layout === "compare" && source) {
      return { width: Math.round((source.width / source.height) * height) + COMPARE_GAP + width, height };
    }
    return { width, height };
  })();

  const handleDownload = async () => {
    setBusy("download");
    setNotice(null);
    try {
      saveBlob(await buildBlob(), `${name || "renvia-render"}.${formatSpec.ext}`);
      close();
    } catch {
      setNotice("Download failed. Try again, or pick another format.");
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!render) return;
    setBusy("copy");
    setNotice(null);
    try {
      const canvas = compose();
      if (!canvas) throw new Error("Canvas unavailable");
      const png = await toBlob(canvas, "image/png");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setNotice("Copied — paste it into a doc, deck or chat.");
    } catch {
      setNotice("Your browser blocked copying the image. Download it instead.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dl-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="dl-dialog" role="dialog" aria-modal="true" aria-labelledby="dl-title">
        <div className={`dl-preview ${layout === "compare" ? "is-compare" : ""}`}>
          {layout === "compare" && (
            <figure>
              <img src={job.sourceImageUrl} alt="" />
              <figcaption>Before</figcaption>
            </figure>
          )}
          <figure>
            <img src={imageUrl} alt="Render to download" />
            {layout === "compare" && <figcaption>After</figcaption>}
          </figure>
          {!render && !loadError && <span className="dl-loading" aria-label="Loading image" />}
        </div>

        <aside className="dl-options">
          <header>
            <div>
              <h2 id="dl-title">Download</h2>
              <p>{[job.settings?.edit ? "Edit" : "Render", job.viewLabel].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" className="dl-close" onClick={close} aria-label="Close">
              <svg viewBox="0 0 14 14" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </header>

          {loadError ? (
            <p className="dl-error">Couldn't load this image. Check your connection and try again.</p>
          ) : (
            <>
              <section>
                <p className="dl-label">Format</p>
                <div className="dl-segmented" role="radiogroup" aria-label="Format">
                  {FORMATS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={format === item.id}
                      className={format === item.id ? "is-active" : ""}
                      onClick={() => setFormat(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <small className="dl-hint">{formatSpec.hint}</small>
              </section>

              <section>
                <p className="dl-label">Size</p>
                <div className="dl-sizes" role="radiogroup" aria-label="Size">
                  <button type="button" role="radio" aria-checked={edge === null} className={edge === null ? "is-active" : ""} onClick={() => setEdge(null)}>
                    <strong>Original</strong>
                    <span>{original ? `${original.width} × ${original.height}` : "…"}</span>
                    <small>Full quality</small>
                  </button>
                  {sizes.map((preset) => {
                    const ratio = original ? preset.edge / Math.max(original.width, original.height) : 1;
                    return (
                      <button
                        key={preset.edge}
                        type="button"
                        role="radio"
                        aria-checked={edge === preset.edge}
                        className={edge === preset.edge ? "is-active" : ""}
                        onClick={() => setEdge(preset.edge)}
                      >
                        <strong>{preset.label}</strong>
                        <span>{original ? `${Math.round(original.width * ratio)} × ${Math.round(original.height * ratio)}` : "…"}</span>
                        <small>{preset.hint}</small>
                      </button>
                    );
                  })}
                </div>
                <small className="dl-hint">
                  The AI delivers renders at {original ? `${original.width} × ${original.height}` : "its native size"} — that's the
                  highest quality available.
                </small>
              </section>

              <section>
                <p className="dl-label">Layout</p>
                <div className="dl-segmented" role="radiogroup" aria-label="Layout">
                  <button type="button" role="radio" aria-checked={layout === "render"} className={layout === "render" ? "is-active" : ""} onClick={() => setLayout("render")}>
                    Render only
                  </button>
                  <button type="button" role="radio" aria-checked={layout === "compare"} className={layout === "compare" ? "is-active" : ""} onClick={() => setLayout("compare")}>
                    Before & after
                  </button>
                </div>
                <small className="dl-hint">
                  {layout === "compare" ? "Your elevation and the render side by side — handy for client reviews." : "Just the rendered image."}
                </small>
              </section>

              <section>
                <label className="dl-label" htmlFor="dl-name">
                  File name
                </label>
                <div className="dl-name">
                  <input id="dl-name" value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} />
                  <span>.{formatSpec.ext}</span>
                </div>
              </section>

              <div className="dl-actions">
              <div className="dl-summary">
                <span>{outputSize ? `${outputSize.width} × ${outputSize.height} px` : "Measuring…"}</span>
                <span>{estimate !== null ? `≈ ${formatBytes(estimate)}` : "…"}</span>
              </div>

              {notice && <p className="dl-notice">{notice}</p>}

              <footer>
                <button type="button" className="dl-secondary" onClick={() => void handleCopy()} disabled={!render || !compareReady || busy !== null}>
                  {busy === "copy" ? "Copying…" : "Copy image"}
                </button>
                <button
                  ref={downloadRef}
                  type="button"
                  className="dl-primary"
                  onClick={() => void handleDownload()}
                  disabled={!render || !compareReady || busy !== null}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 12.5h10" />
                  </svg>
                  {busy === "download" ? "Preparing…" : "Download"}
                </button>
              </footer>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
