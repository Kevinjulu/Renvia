import { legacyCreditPrices, type CreditPrices, type MeResponse } from "@renvia/types";

/**
 * What each action costs this user, as the API charges it. An API from before published prices
 * doesn't send them, so fall back to the per-image multipliers it does send.
 */
export function creditPricesFor(me: MeResponse | null | undefined): CreditPrices {
  return me?.creditPrices ?? legacyCreditPrices(me?.creditsPerImage ?? 1, me?.creditsPerSelection ?? 1);
}
