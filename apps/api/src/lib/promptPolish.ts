import { createFalClient } from "@fal-ai/client";
import { and, eq, gte, sql } from "drizzle-orm";
import { schema, type Database } from "@renvia/db";
import type { PromptPolishKind, PromptPolishResponse } from "@renvia/types";
import type { Env } from "../index.js";
import { engineMode, wouldExceedBudget } from "./engine.js";
import { repairReferencePrompt } from "./prompts.js";

/**
 * "Polish prompt": rewrites what someone typed into a short, precise architectural brief and
 * returns it as a suggestion they can accept or ignore. A language model does the rewriting
 * (through fal's OpenRouter endpoint, on the same fal account and spending cap as renders); when
 * the model is off, over budget or fails, a deterministic tidy-up is used instead. Free to users.
 */

export const POLISH_ENDPOINT = "openrouter/router";
const DEFAULT_MODEL = "google/gemini-2.5-flash";
/** Assumed cost of one polish when the response doesn't report it: generous for ~500 tokens. */
export const ESTIMATED_POLISH_COST_MICROS = 1_000;
const MAX_POLISHED_CHARS = 600;
const TIMEOUT_MS = 20_000;

const REPLY_FORMAT = `Reply with JSON only, no other text: {"prompt": "...", "notes": ["...", "..."]}. "notes" are up to three short phrases saying what you improved, for example "Named the cladding material" or "Removed a request to change the roof".`;

const SYSTEM_PROMPTS: Record<PromptPolishKind, string> = {
  render: `You refine prompts for an architectural visualisation tool. It turns an uploaded building elevation, drawing or 3D model into a photoreal render. The building's design always comes from the uploaded image; the prompt only directs materials, finishes, colours, lighting, time of day, weather, landscape, surroundings and mood.

Rewrite the user's prompt into one clear rendering brief:
- Keep their intent and every concrete choice they made (materials, colours, places, moods). Never invent a different style or change their meaning.
- Use precise architectural language: name materials and finishes (for example "vertical natural oak cladding", "smooth white render", "dark bronze window frames"), the light ("soft overcast daylight", "warm golden-hour light") and the landscape.
- Never ask to add, remove, move or reshape parts of the building (roof, windows, doors, floors, balconies, columns, footprint) or to change the camera, view or angle. Leave such requests out.
- Remove filler, politeness, questions, repetition and lists of things to avoid.
- 15 to 45 words, one or two sentences, plain text.

${REPLY_FORMAT}`,
  edit: `You refine prompts for an architectural visualisation tool. The user describes one change to an existing render of a building, for example replacing the front door, changing a facade material, or adding planting. The tool keeps the rest of the image as it is by itself.

Rewrite the user's prompt into one clear, specific edit instruction:
- Say what to change, what it becomes (material, colour, finish, style) and where, using precise architectural language (for example "Replace the front door with a dark oak pivot door with a slim steel handle").
- Keep their intent and every concrete choice they made. Never invent extra changes.
- If they asked for several unrelated changes, keep the most important one and add a note that the others work better as separate edits.
- Don't add "keep everything else the same": the tool does that.
- Remove filler, politeness, questions and repetition.
- 8 to 30 words, one sentence, plain text.

${REPLY_FORMAT}`,
};

export interface PolishInput {
  prompt: string;
  kind: PromptPolishKind;
  /** A render with references: requests that would redesign the source are left out. */
  sourceLocked: boolean;
}

export interface PolishOutcome {
  result: Omit<PromptPolishResponse, "remainingToday">;
  model: string | null;
  costMicros: number;
}

/** Polishes started today (UTC) by this person, whichever engine served them. */
export async function polishesToday(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.promptPolishes)
    .where(and(eq(schema.promptPolishes.userId, userId), gte(schema.promptPolishes.createdAt, sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`)));
  return row?.count ?? 0;
}

/** The free deterministic tidy-up: whitespace, trailing punctuation, and the structure guard. */
export function rulesPolish({ prompt, kind, sourceLocked }: PolishInput): PolishOutcome["result"] {
  const tidy = prompt.replace(/\s+/g, " ").trim();
  if (kind === "render" && sourceLocked) {
    const repaired = repairReferencePrompt(tidy);
    return { prompt: repaired.prompt, notes: repaired.repairs, blocked: repaired.blocked, engine: "rules" };
  }
  return { prompt: tidy, notes: tidy === prompt ? [] : ["Tidied spacing."], blocked: [], engine: "rules" };
}

/**
 * Reads the model's reply: JSON with a prompt and notes, possibly fenced or with stray text
 * around it. Returns null when there is no usable prompt.
 */
export function parsePolishReply(output: string): { prompt: string; notes: string[] } | null {
  const json = output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1);
  let prompt = "";
  let notes: string[] = [];
  try {
    const parsed = JSON.parse(json) as { prompt?: unknown; notes?: unknown };
    if (typeof parsed.prompt === "string") prompt = parsed.prompt;
    if (Array.isArray(parsed.notes)) notes = parsed.notes.filter((note): note is string => typeof note === "string");
  } catch {
    return null;
  }
  prompt = prompt.replace(/\s+/g, " ").replace(/^["'“”\s]+|["'“”\s]+$/g, "").trim();
  if (!prompt) return null;
  if (prompt.length > MAX_POLISHED_CHARS) prompt = `${prompt.slice(0, MAX_POLISHED_CHARS).replace(/\s+\S*$/, "")}.`;
  return { prompt, notes: notes.map((note) => note.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3) };
}

/** The model's own rewrite, or null when it fails, times out or replies with nothing usable. */
async function aiPolish(env: Env, input: PolishInput, model: string): Promise<{ prompt: string; notes: string[]; costMicros: number } | null> {
  const fal = createFalClient({ credentials: env.FAL_KEY });
  const request = fal.subscribe(POLISH_ENDPOINT, {
    input: { model, system_prompt: SYSTEM_PROMPTS[input.kind], prompt: input.prompt, temperature: 0.3, max_tokens: 400 },
    logs: false,
  });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const result = await Promise.race([request, timeout]);
  if (!result) return null;
  const data = result.data as { output?: string; error?: string | null; usage?: { cost?: number } | null };
  if (data.error || !data.output) return null;
  const parsed = parsePolishReply(data.output);
  if (!parsed) return null;
  const reported = typeof data.usage?.cost === "number" ? Math.round(data.usage.cost * 1_000_000) : 0;
  return { ...parsed, costMicros: Math.max(reported, ESTIMATED_POLISH_COST_MICROS) };
}

/**
 * Polishes a prompt: with the language model when renders are live and the fal budget has room,
 * otherwise (or if the model fails) with the deterministic tidy-up. Never throws for a model error.
 */
export async function polishPrompt(env: Env, db: Database, input: PolishInput): Promise<PolishOutcome> {
  const model = env.POLISH_MODEL?.trim() || DEFAULT_MODEL;
  const live = (await engineMode(env, db)) !== "mock" && Boolean(env.FAL_KEY);
  // Once the model has been asked, fal may bill even if its reply goes unused or arrives late.
  let attemptedCost = 0;
  if (live && !(await wouldExceedBudget(env, db, ESTIMATED_POLISH_COST_MICROS))) {
    attemptedCost = ESTIMATED_POLISH_COST_MICROS;
    try {
      const ai = await aiPolish(env, input, model);
      if (ai) {
        // The structure guard still applies to whatever the model wrote.
        if (input.kind === "render" && input.sourceLocked) {
          const guarded = repairReferencePrompt(ai.prompt);
          const original = repairReferencePrompt(input.prompt);
          if (guarded.prompt) {
            return {
              result: { prompt: guarded.prompt, notes: ai.notes, blocked: [...new Set([...original.blocked, ...guarded.blocked])], engine: "ai" },
              model,
              costMicros: ai.costMicros,
            };
          }
        } else {
          return { result: { prompt: ai.prompt, notes: ai.notes, blocked: [], engine: "ai" }, model, costMicros: ai.costMicros };
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "warn", event: "prompt_polish.ai_failed", model, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { result: rulesPolish(input), model: attemptedCost ? model : null, costMicros: attemptedCost };
}
