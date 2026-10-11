/**
 * Whether this browser is probably signed in to the Studio. The Studio is a separate site, so
 * this can't read its sign-in; instead the Studio's links here carry ?studio=signed-in, and
 * signing out lands here with ?studio=signed-out. The answer is remembered on this browser for
 * a week (about a Clerk session), and is only ever used to tailor the header — the Studio
 * itself still decides who is signed in.
 */
const KEY = "renvia:studio-signed-in-until";
const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;

/** Applies a ?studio= note from the Studio, removes it from the address bar, and returns the result. */
export function syncStudioSession(): boolean {
  try {
    const url = new URL(window.location.href);
    const note = url.searchParams.get("studio");
    if (note === "signed-in") localStorage.setItem(KEY, String(Date.now() + REMEMBER_MS));
    if (note === "signed-out") localStorage.removeItem(KEY);
    if (note) {
      url.searchParams.delete("studio");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return Number(localStorage.getItem(KEY)) > Date.now();
  } catch {
    // Storage blocked (private mode): show the signed-out header, which always works.
    return false;
  }
}
