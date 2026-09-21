import { extensionForContentType } from "./storage.js";

/** A pasted link we couldn't turn into an image; `message` is safe to show the user. */
export class ImportImageError extends Error {}

export interface ImportedImage {
  bytes: ArrayBuffer;
  contentType: string;
}

const FETCH_TIMEOUT_MS = 10_000;
// Some sites (Pinterest among them) serve an empty shell to unknown clients.
const USER_AGENT = "Mozilla/5.0 (compatible; RenviaBot/1.0; +https://renvia.app)";

/**
 * Fetches a pasted link as an image. People paste the page they found the picture on far more
 * often than the image address itself, so a page is followed to its preview image (og:image), and
 * a Google Images result link to the image it wraps.
 */
export async function importImageFromUrl(rawUrl: string, maxBytes: number): Promise<ImportedImage> {
  const url = unwrapGoogleImagesLink(parsePublicUrl(rawUrl));
  const response = await fetchPublic(url);
  const contentType = contentTypeOf(response);

  if (extensionForContentType(contentType)) return readImage(response, contentType, maxBytes);

  if (contentType === "text/html") {
    const previewUrl = previewImageOf(await response.text(), url);
    if (!previewUrl) throw new ImportImageError("That page doesn't have an image we can use. Right-click the image and copy its address instead.");
    const preview = await fetchPublic(parsePublicUrl(previewUrl));
    const previewType = contentTypeOf(preview);
    if (extensionForContentType(previewType)) return readImage(preview, previewType, maxBytes);
  }

  throw new ImportImageError("That link isn't a PNG, JPEG or WebP image.");
}

function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportImageError("That doesn't look like a link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ImportImageError("Only http and https links are supported.");
  if (isPrivateHost(url.hostname)) throw new ImportImageError("That link isn't publicly reachable.");
  return url;
}

// Keeps the server from being pointed at itself or the private network.
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (host.includes(":")) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** google.com/imgres?imgurl=… is what "copy link" gives on a Google Images result. */
function unwrapGoogleImagesLink(url: URL): URL {
  const wrapped = /(^|\.)google\.[a-z.]+$/.test(url.hostname) ? url.searchParams.get("imgurl") : null;
  return wrapped ? parsePublicUrl(wrapped) : url;
}

async function fetchPublic(url: URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/png,image/jpeg,text/html;q=0.8,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ImportImageError("Couldn't reach that link.");
  }
  // A redirect can land somewhere the original host check never saw.
  if (response.url && isPrivateHost(new URL(response.url).hostname)) throw new ImportImageError("That link isn't publicly reachable.");
  if (!response.ok) throw new ImportImageError(`That site refused the request (${response.status}). Try saving the image and uploading it instead.`);
  return response;
}

function contentTypeOf(response: Response): string {
  return response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readImage(response: Response, contentType: string, maxBytes: number): Promise<ImportedImage> {
  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ImportImageError("That image is too large.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new ImportImageError("That image is too large.");
  return { bytes, contentType };
}

function previewImageOf(html: string, pageUrl: URL): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = attribute(tag, "property") ?? attribute(tag, "name");
    if (key !== "og:image" && key !== "og:image:url" && key !== "og:image:secure_url" && key !== "twitter:image") continue;
    const content = attribute(tag, "content");
    if (!content) continue;
    try {
      return new URL(decodeEntities(content), pageUrl).toString();
    } catch {
      // Unusable value; try the next tag.
    }
  }
  return null;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? null) : null;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
