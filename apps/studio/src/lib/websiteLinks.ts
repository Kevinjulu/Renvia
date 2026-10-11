import { MARKETING_URL } from "./env";

/**
 * The website and the Studio are separate sites, so the website can't see the Studio's
 * sign-in. Links from the Studio say whether the person is signed in; the website remembers
 * that on the browser to tailor its header (see apps/marketing/lib/studioSession.ts).
 */
export function websiteUrl(path = "/", state?: "signed-in" | "signed-out"): string {
  const url = new URL(path, MARKETING_URL);
  if (state) url.searchParams.set("studio", state);
  return url.toString();
}
