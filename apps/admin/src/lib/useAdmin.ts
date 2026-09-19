import { createContext, useContext } from "react";
import type { MeResponse } from "@renvia/types";

/** The signed-in admin, provided once the access gate in App has confirmed the role. */
export const AdminContext = createContext<MeResponse | null>(null);

export function useAdmin(): MeResponse {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error("useAdmin must be used inside the admin gate");
  return admin;
}
