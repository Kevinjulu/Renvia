/**
 * Runs a Generate's render requests without ever sending more than the plan allows at once.
 * The plan's concurrent-render cap used to refuse everything past its first request; now the
 * rest wait in line and start as slots free up. Nothing is sent (or charged) until its turn.
 *
 * No imports, so its unit test can run it directly under Node.
 */

export interface ThrottleProgress {
  total: number;
  /** Requests the server has accepted so far. */
  accepted: number;
  /** True while the rest are waiting for a slot. */
  waiting: boolean;
}

export interface ThrottleOptions {
  /** Slots free right now, from what the Studio knows is running; null = no cap. */
  freeSlots: () => number | null;
  /** Resolves when something may have changed (a job finished), and at most after `ms`. */
  waitForChange: (ms: number) => Promise<void>;
  /** A refusal that only means "every slot is busy right now": the request goes back in line. */
  isBusy: (error: unknown) => boolean;
  /** A refusal waiting can't fix (credits, daily limit…): whatever is still waiting is dropped. */
  isFatal: (error: unknown) => boolean;
  signal?: AbortSignal;
  onProgress?: (progress: ThrottleProgress) => void;
  /** Gives up on the line when nothing was accepted for this long (default 12 minutes). */
  maxIdleMs?: number;
  /** Pause after a busy refusal before trying again (default 2.5 seconds). */
  busyCooldownMs?: number;
}

const DEFAULT_MAX_IDLE_MS = 12 * 60_000;
const DEFAULT_BUSY_COOLDOWN_MS = 2_500;
const POLL_MS = 3_000;

function abortError(): Error {
  const error = new Error("Stopped before it was sent");
  error.name = "AbortError";
  return error;
}

/** Same result shape as Promise.allSettled, in the order of `tasks`. */
export async function runThrottled<T>(tasks: (() => Promise<T>)[], options: ThrottleOptions): Promise<PromiseSettledResult<T>[]> {
  const { freeSlots, waitForChange, isBusy, isFatal, signal, onProgress } = options;
  const maxIdle = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
  const cooldown = options.busyCooldownMs ?? DEFAULT_BUSY_COOLDOWN_MS;

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  const line: number[] = tasks.map((_, index) => index);
  const running = new Set<Promise<void>>();
  let sending = 0;
  let accepted = 0;
  // Held in an object so the checks below see changes made inside the callbacks.
  const stop: { fatal: boolean; reason: unknown } = { fatal: false, reason: null };
  let lastBusy: unknown = null;
  let coolUntil = 0;
  let lastAccepted = Date.now();

  const report = () => onProgress?.({ total: tasks.length, accepted, waiting: line.length > 0 });

  const dropLine = (reason: unknown) => {
    for (const index of line.splice(0)) results[index] = { status: "rejected", reason };
  };

  const send = (index: number) => {
    sending += 1;
    const attempt: Promise<void> = tasks[index]!()
      .then(
        (value) => {
          results[index] = { status: "fulfilled", value };
          accepted += 1;
          lastAccepted = Date.now();
        },
        (reason: unknown) => {
          if (isBusy(reason)) {
            line.unshift(index);
            lastBusy = reason;
            coolUntil = Date.now() + cooldown;
            return;
          }
          results[index] = { status: "rejected", reason };
          if (isFatal(reason)) {
            stop.fatal = true;
            stop.reason = reason;
          }
        },
      )
      .finally(() => {
        sending -= 1;
        running.delete(attempt);
        report();
      });
    running.add(attempt);
  };

  report();
  while (line.length > 0 || running.size > 0) {
    if (signal?.aborted) dropLine(abortError());
    else if (stop.fatal) dropLine(stop.reason);

    let waitMs = POLL_MS;
    if (line.length > 0) {
      const remainingCooldown = coolUntil - Date.now();
      if (remainingCooldown > 0) {
        waitMs = remainingCooldown;
      } else {
        const free = freeSlots();
        const room = free === null ? line.length : Math.max(0, free - sending);
        for (let i = 0, n = Math.min(room, line.length); i < n; i += 1) send(line.shift()!);
        report();
      }
      if (line.length > 0 && running.size === 0 && Date.now() - lastAccepted > maxIdle) {
        dropLine(lastBusy ?? new Error("Timed out waiting for a free render slot"));
      }
    }
    if (line.length === 0 && running.size === 0) break;
    await Promise.race([...running, waitForChange(waitMs)]);
  }
  report();
  return results;
}
