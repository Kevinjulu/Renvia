// TODO: set NEXT_PUBLIC_STUDIO_URL in production env; falls back to local dev port.
export const STUDIO_URL = process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:5173";

export const SIGNUP_URL = `${STUDIO_URL}/signup`;
export const LOGIN_URL = `${STUDIO_URL}/login`;
