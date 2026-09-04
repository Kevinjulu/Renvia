export interface UnsplashPhoto {
  id: string;
  thumbUrl: string;
  fullUrl: string;
  alt: string;
}

const ACCESS_KEY = import.meta.env.VITE_UNSPLASH_ACCESS_KEY as string | undefined;

export function isUnsplashConfigured(): boolean {
  return Boolean(ACCESS_KEY);
}

interface UnsplashApiPhoto {
  id: string;
  alt_description: string | null;
  urls: { thumb: string; regular: string };
}

export async function searchUnsplash(query: string): Promise<UnsplashPhoto[]> {
  if (!ACCESS_KEY) {
    throw new Error("Unsplash is not configured");
  }

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "15");

  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
  });
  if (!response.ok) {
    throw new Error(`Unsplash search failed: ${response.status}`);
  }

  const data = (await response.json()) as { results: UnsplashApiPhoto[] };
  return data.results.map((photo) => ({
    id: photo.id,
    thumbUrl: photo.urls.thumb,
    fullUrl: photo.urls.regular,
    alt: photo.alt_description ?? "Unsplash photo",
  }));
}
