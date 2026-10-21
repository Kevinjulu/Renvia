import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Images, Trash2, Upload } from "lucide-react";
import { thumbnailUrl, DESIGN_CATEGORIES, REFERENCE_CATEGORIES, SAMPLE_CATEGORIES, type AdminStockReference, type SampleCategory } from "@renvia/types";
import { Button, Card, EmptyState, ErrorNote, Pill, Skeleton } from "../components/ui";
import { PageHero } from "../components/PageHero";
import { useAdminApi } from "../lib/api";
import { navForPath } from "../lib/nav";
import { useLoad } from "../lib/useLoad";
import { inputClass } from "./settings/components";

const ACCEPTED = "image/png,image/jpeg,image/webp";

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

function errorText(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

/** The groups the category chips are shown in. */
const GROUPS = [
  { label: "References", categories: REFERENCE_CATEGORIES },
  { label: "Designs", categories: DESIGN_CATEGORIES },
] as const;

/** Sample images every Studio user can pick in Samples: reference images, and original designs to start from. */
export function LibraryPage() {
  const api = useAdminApi();
  const nav = navForPath("/library");
  const { data, error, reload } = useLoad(() => api.listStockReferences(), [api]);
  const [items, setItems] = useState<AdminStockReference[]>([]);
  const [category, setCategory] = useState<SampleCategory>(SAMPLE_CATEGORIES[0].key);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) setItems(data.references);
  }, [data]);

  const inCategory = items.filter((item) => item.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const replace = (next: AdminStockReference) => setItems((current) => current.map((item) => (item.id === next.id ? next : item)));

  const upload = async (files: File[]) => {
    const images = files.filter((file) => ACCEPTED.split(",").includes(file.type));
    if (images.length === 0) {
      setStatus({ tone: "error", text: "Drop PNG, JPEG or WebP images." });
      return;
    }
    setStatus(null);
    const failures: string[] = [];
    setUploading({ done: 0, total: images.length });
    for (const [index, file] of images.entries()) {
      try {
        const created = await api.uploadStockReference(category, file, "");
        setItems((current) => [...current, created]);
      } catch (reason) {
        failures.push(`${file.name}: ${errorText(reason, "upload failed")}`);
      }
      setUploading({ done: index + 1, total: images.length });
    }
    setUploading(null);
    const added = images.length - failures.length;
    setStatus(
      failures.length
        ? { tone: "error", text: `${added} added. Couldn't add ${failures.join("; ")}` }
        : { tone: "ok", text: `${added} image${added === 1 ? "" : "s"} added. Add a short caption so users know what they're looking at.` },
    );
  };

  const saveCaption = async (item: AdminStockReference, caption: string) => {
    if ((item.caption ?? "") === caption.trim()) return;
    try {
      replace(await api.updateStockReference(item.id, { caption }));
    } catch (reason) {
      setStatus({ tone: "error", text: errorText(reason, "Couldn't save the caption") });
    }
  };

  const toggleHidden = async (item: AdminStockReference) => {
    try {
      replace(await api.updateStockReference(item.id, { hidden: !item.hidden }));
    } catch (reason) {
      setStatus({ tone: "error", text: errorText(reason, "Couldn't change that image") });
    }
  };

  const move = async (index: number, step: -1 | 1) => {
    const target = index + step;
    if (target < 0 || target >= inCategory.length) return;
    const ordered = [...inCategory];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    const positions = new Map(ordered.map((item, position) => [item.id, position]));
    setItems((current) => current.map((item) => (positions.has(item.id) ? { ...item, sortOrder: positions.get(item.id)! } : item)));
    try {
      await api.orderStockReferences(category, ordered.map((item) => item.id));
    } catch (reason) {
      setStatus({ tone: "error", text: errorText(reason, "Couldn't save the order") });
      reload();
    }
  };

  const remove = async (item: AdminStockReference) => {
    if (!window.confirm("Delete this image? Users won't see it any more and it's removed from storage. This can't be undone.")) return;
    try {
      await api.deleteStockReference(item.id);
      setItems((current) => current.filter((other) => other.id !== item.id));
    } catch (reason) {
      setStatus({ tone: "error", text: errorText(reason, "Couldn't delete that image") });
    }
  };

  const label = SAMPLE_CATEGORIES.find((item) => item.key === category)!.label;
  const isDesign = DESIGN_CATEGORIES.some((item) => item.key === category);

  return (
    <>
      <PageHero title={nav.title} description={nav.description} image={nav.banner} />
      {error && !data && <ErrorNote onRetry={reload}>{error}</ErrorNote>}
      {status && (
        <p role="status" className={`mb-6 rounded-xl border px-4 py-3 text-sm ${status.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {status.text}
        </p>
      )}

      {!data ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted">
            These images appear for every Studio user in <strong className="text-primary">Samples</strong>. <strong className="text-primary">References</strong> are attached to a render with a click; nothing is
            copied into the user&apos;s account. <strong className="text-primary">Designs</strong> (a 3D model such as ArchiCAD, a photo or a drawing) are original buildings a new user can start a project from:
            the picked image is copied into their own storage as their elevation. Images are shrunk to WebP (1600 px, under 600 KB) on upload. Categories with no visible images are hidden from users.
            Stored so far: <strong className="text-primary">{formatBytes(totalBytes)}</strong>.
          </p>

          <div className="space-y-3" role="tablist" aria-label="Categories">
            {GROUPS.map((group) => (
              <div key={group.label} className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-xs font-semibold uppercase tracking-[.08em] text-faint">{group.label}</span>
                {group.categories.map((item) => {
                  const count = items.filter((other) => other.category === item.key).length;
                  const active = item.key === category;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setCategory(item.key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${active ? "border-primary bg-primary text-white" : "border-hairline bg-canvas text-primary hover:border-hairline-strong"}`}
                    >
                      {item.label}
                      <span className={`tabular-nums text-xs ${active ? "text-white/70" : "text-faint"}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <Card
            title={isDesign ? `${label} designs` : `${label} samples`}
            icon={Images}
            actions={
              <Button variant="primary" icon={Upload} disabled={uploading !== null} onClick={() => fileInputRef.current?.click()}>
                {uploading ? `Uploading ${uploading.done + 1} of ${uploading.total}…` : "Upload images"}
              </Button>
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              multiple
              className="hidden"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length) void upload(files);
              }}
            />
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!uploading) void upload([...event.dataTransfer.files]);
              }}
              className={`rounded-xl border-2 border-dashed p-3 transition ${dragging ? "border-blueprint bg-blueprint-soft/40" : "border-transparent"}`}
            >
              {inCategory.length === 0 ? (
                <EmptyState icon={Images}>No {label.toLowerCase()} {isDesign ? "designs" : "samples"} yet. Drop images here or use Upload images.{isDesign ? " Whole-building images work best: they become a new user's first elevation." : ""}</EmptyState>
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                  {inCategory.map((item, index) => (
                    <li key={item.id} className={`overflow-hidden rounded-xl border border-hairline bg-surface ${item.hidden ? "opacity-60" : ""}`}>
                      <div className="relative aspect-[4/3] bg-surface-muted">
                        <img src={thumbnailUrl(item.url)} alt={item.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                        {item.hidden && <span className="absolute left-2 top-2"><Pill tone="amber">Hidden</Pill></span>}
                      </div>
                      <div className="space-y-2 p-3">
                        <input
                          key={item.caption ?? ""}
                          defaultValue={item.caption ?? ""}
                          maxLength={120}
                          placeholder="Caption, e.g. Black aluminium casement"
                          aria-label="Caption"
                          className={`${inputClass()} text-xs`}
                          onBlur={(event) => void saveCaption(item, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" className="px-2 py-1" aria-label="Move earlier" title="Move earlier" disabled={index === 0} onClick={() => void move(index, -1)}>
                            <ArrowLeft size={14} />
                          </Button>
                          <Button variant="ghost" className="px-2 py-1" aria-label="Move later" title="Move later" disabled={index === inCategory.length - 1} onClick={() => void move(index, 1)}>
                            <ArrowRight size={14} />
                          </Button>
                          <span className="ml-auto text-[11px] tabular-nums text-faint">{formatBytes(item.bytes)}</span>
                          <Button variant="ghost" className="px-2 py-1" title={item.hidden ? "Show to users" : "Hide from users"} onClick={() => void toggleHidden(item)}>
                            {item.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                          </Button>
                          <Button variant="ghost" className="px-2 py-1 text-rose-600 hover:text-rose-700" title="Delete" aria-label="Delete" onClick={() => void remove(item)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
