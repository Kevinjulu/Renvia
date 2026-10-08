// Typed outputs of the two experimental analysis modules (Phase 3).
//
// Design rules that follow from the Round 1/2 findings:
//  - Structure analysis describes ONLY the uploaded elevation. Every element carries a confidence, and
//    anything the model cannot establish goes to `unknowns` instead of being guessed.
//  - Material analysis describes ONLY finishes. It has no geometry fields, so reference-building shape
//    cannot reach the renderer. Architectural features it notices are listed in `structuralFeaturesSeen`
//    purely so they can be turned into "never add" constraints.
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { z } = require("zod");

const confidence = z.enum(["high", "medium", "low"]).catch("low");
const text = z.string().trim().min(1);

const element = (kinds) =>
  z.object({
    id: z.string().trim().min(1).regex(/^[a-z0-9_]+$/),
    kind: z.enum(kinds).catch(kinds.at(-1)),
    location: text,
    description: text,
    /** Count only when it can be established by counting what is drawn; otherwise null. */
    count: z.number().int().positive().nullable().catch(null),
    confidence,
  });

export const ROOF_FORMS = ["flat", "skillion", "gable", "hip", "mixed", "other", "unknown"];

export const StructureAnalysis = z.object({
  viewType: z.enum(["orthographic_elevation", "perspective", "photo", "other"]).catch("other"),
  viewDescription: text,
  storeys: z.object({ count: z.number().int().min(1).max(10).nullable().catch(null), confidence }),
  roof: z.object({ form: z.enum(ROOF_FORMS).catch("unknown"), description: text, confidence }),
  volumes: z.array(element(["main_volume", "wing", "block", "other"])),
  openings: z.array(element(["window", "door", "glazed_wall", "garage_door", "other"])),
  guardrails: z.array(element(["glass_panel", "balustrade", "rail", "solid_parapet", "other"])),
  facadeElements: z.array(
    element(["fins", "columns", "canopy", "cantilever", "stairs", "balcony", "chimney", "downpipe", "cladding_panel", "pergola", "other"]),
  ),
  unknowns: z.array(z.string()),
  /** Plain-language invariants the renderer must not break, derived from the drawing only. */
  preservationConstraints: z.array(z.string()).min(1),
});

const surface = z.object({
  surface: z.enum(["walls_primary", "walls_secondary", "cladding", "base_plinth", "roof_covering", "window_frames", "doors", "soffit_fascia", "guardrail", "paving", "other"]).catch("other"),
  material: text,
  colour: z.object({ name: text, hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().catch(null) }),
  finish: z.string().nullable().catch(null),
  confidence,
});

export const MaterialAnalysis = z.object({
  surfaces: z.array(surface).min(1),
  palette: z.array(z.object({ name: text, hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().catch(null) })),
  atmosphere: z.object({ timeOfDay: text, sky: text, lightQuality: text, warmCast: z.boolean().catch(false) }),
  landscape: z.object({ groundCover: z.string().nullable().catch(null), planting: z.string().nullable().catch(null), hardscape: z.string().nullable().catch(null) }),
  /** Architecture seen in the reference (columns, arches, gables...). Never transferred; becomes "do not add". */
  structuralFeaturesSeen: z.array(z.string()),
  unknowns: z.array(z.string()),
});

export const MaterialObservation = z.object({
  roles: z.array(
    z.object({
      role: z.string(),
      visible: z.boolean().catch(false),
      colourName: z.string().catch(""),
      hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().catch(null),
      material: z.string().catch(""),
    }),
  ),
});

export const FidelityCheck = z.object({
  checks: z.array(z.object({ id: z.string(), status: z.enum(["kept", "changed", "missing", "unclear"]).catch("unclear"), note: z.string().catch("") })),
  addedElements: z.array(z.string()),
  roof: z.object({ status: z.enum(["kept", "changed"]).catch("changed"), note: z.string().catch("") }),
  camera: z.object({ status: z.enum(["kept", "changed"]).catch("changed"), note: z.string().catch("") }),
  photorealistic: z.boolean().catch(false),
  wallColourObserved: z.string().catch(""),
});
