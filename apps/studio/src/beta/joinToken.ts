const KEY = "renvia.beta.joinToken";

/** Remembers an invitation token across sign-up or sign-in, which leave the join page. */
export function rememberJoinToken(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Private mode: the tester can open the link again after signing in.
  }
}

/** The remembered token, removed as it's read so it's used once. */
export function takePendingJoinToken(): string | null {
  try {
    const token = sessionStorage.getItem(KEY);
    if (token) sessionStorage.removeItem(KEY);
    return token;
  } catch {
    return null;
  }
}
