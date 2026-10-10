
/** Re-asks after an unanswered request, waiting longer each time, before giving up. */
const CONFIRM_DELAYS_MS = [3_000, 8_000];

/**
 * Keys of requests that went unanswered, by what was asked. Clicking again with the same
 * request reuses its key, so if the first attempt did reach the server, the retry gets that
 * render back instead of paying for a second one.
 */
const unconfirmed = new Map<string, string>();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A ConnectionError (lib/connection.ts), matched by name so this module has no runtime imports
 * and its unit test can run it directly under Node.
 */
const wentUnanswered = (error: unknown) => error instanceof Error && error.name === "ConnectionError";

export class RenderNotConfirmedError extends Error {
  constructor() {
    super("Renvia didn't confirm whether the render started");
    this.name = "RenderNotConfirmedError";
  }
}

interface QueueRenderOptions {
  /**
   * Tells identical requests in one click apart (each view, each variation), since they'd
   * otherwise share a key and the server would only create one of them.
   */
  slot: string;
  /**
   * What makes two clicks "the same request", when the body alone can't say: an edit uploads a
   * fresh mask each click, so its mask URL differs even when nothing else does.
   */
  signature?: string;
  /** Called once when an attempt goes unanswered and the request is being re-checked. */
  onSlow?: () => void;
}

/**
 * Queues a render (or a high-resolution export) without ever charging twice for one click. The request carries an
 * idempotency key; when it goes unanswered (timeout, dropped connection) it is re-sent with
 * the same key, which either returns the render the first attempt created or creates it now.
 * Answers from the server — refusals included — are final and are thrown as they are.
 */
export async function queueRender<Body extends object, Response>(
  send: (body: Body & { idempotencyKey: string }) => Promise<Response>,
  body: Body,
  { slot, signature: given, onSlow }: QueueRenderOptions,
): Promise<Response> {
  const signature = `${slot}|${given ?? JSON.stringify(body)}`;
  const idempotencyKey = unconfirmed.get(signature) ?? crypto.randomUUID();
  const request = { ...body, idempotencyKey };

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await send(request);
      unconfirmed.delete(signature);
      return response;
    } catch (error) {
      if (!wentUnanswered(error)) {
        unconfirmed.delete(signature);
        throw error;
      }
      unconfirmed.set(signature, idempotencyKey);
      const delay = CONFIRM_DELAYS_MS[attempt];
      if (delay === undefined) throw new RenderNotConfirmedError();
      if (attempt === 0) onSlow?.();
      await wait(delay);
    }
  }
}
