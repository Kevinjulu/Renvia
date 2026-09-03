import { createFal } from "@ai-sdk/fal";

export function getFalClient(apiKey: string) {
  return createFal({ apiKey });
}
