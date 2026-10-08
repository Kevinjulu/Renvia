// Turns the two analyses into the text given to Kontext. Pure and deterministic: the same analyses
// always give the same prompt, and every rule here exists because of a specific Round 1/2 failure.
//
//   variant "plain"  (BA)  : inventory + finishes.
//   variant "locked" (BA2) : plain + element-specific "do not substitute" clauses (glass guardrail -> thin
//                            rails), forbidden features lifted from the reference (columns, gables...),
//                            measured colour anchors and a neutral-light clause (white -> cream drift).

const KEEP = new Set(["high", "medium"]);
const hexChroma = (hex) => {
  if (!hex) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const isNeutralWhite = (colour) => {
  if (!colour.hex) return /white/i.test(colour.name);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.hex.slice(i, i + 2), 16));
  return Math.min(r, g, b) > 205 && hexChroma(colour.hex) < 0.09;
};

// Evidence (Phase 3): a stable, "high"-confidence count can still be wrong (15 fins reported, 10 drawn). Numbers
// above 3 therefore never reach the renderer; repeated elements are "kept as drawn" instead.
const firstSentence = (t) => {
  const sentence = t.split(". ")[0];
  return sentence.endsWith(".") ? sentence.slice(0, -1) : sentence;
};
function elementLine(e) {
  const count = e.count && e.count <= 3 && e.count > 1 ? `${e.count} × ` : "";
  return `${count}${firstSentence(e.description)} (${e.location.replace(/_/g, " ")})`;
}

export function composeStructure(structure) {
  const confident = (items) => items.filter((e) => KEEP.has(e.confidence) && !["cladding_panel", "other"].includes(e.kind));
  const seen = new Set();
  const unique = (line) => (seen.has(line) ? false : (seen.add(line), true));
  const parts = [
    `${structure.storeys.count ? `${structure.storeys.count}-storey` : "Multi-level"} building, ${structure.roof.form === "unknown" ? "roof as drawn" : `${structure.roof.form} roof`}: ${firstSentence(structure.roof.description)}.`,
    ...["volumes", "openings", "guardrails", "facadeElements"].flatMap((key) => confident(structure[key]).map(elementLine)).filter(unique),
  ];
  const omitted = [...structure.volumes, ...structure.openings, ...structure.guardrails, ...structure.facadeElements].filter((e) => !KEEP.has(e.confidence));
  return {
    keep: parts.join("; "),
    omittedLowConfidence: omitted.map((e) => e.id),
    unknowns: structure.unknowns,
    constraints: structure.preservationConstraints,
  };
}

/** Roof covering from a reference may only restyle a roof of the same kind. */
function roofClause(structure, materials) {
  const roof = materials.surfaces.find((s) => s.surface === "roof_covering");
  if (!roof) return null;
  const described = structure.roof.description.toLowerCase();
  // The form label and the description can disagree ("mixed" vs "multiple flat roof sections"); the roof counts as pitched only if both support it.
  const pitched = ["gable", "hip"].includes(structure.roof.form) || (structure.roof.form === "mixed" && /gable|hip|pitched|tile/.test(described));
  return pitched
    ? `Roof covering: ${roof.material}, ${roof.colour.name}.`
    : `Roof: keep the drawn ${structure.roof.form === "unknown" ? "" : structure.roof.form + " "}roof exactly with a plain dark neutral surface. Never add tiles, pitches, gables or eaves`;
}

export function composeMaterials(structure, materials, { variant, measuredPalette = [], neutralLighting = false, genericLandscape = false, omitHex = false }) {
  const lines = [];
  for (const s of materials.surfaces.filter((x) => KEEP.has(x.confidence))) {
    if (s.surface === "roof_covering") continue;
    const hex = variant === "locked" && s.colour.hex && !omitHex ? ` (${s.colour.hex})` : "";
    lines.push(`${s.surface.replace(/_/g, " ")}: ${s.material}, ${s.colour.name}${hex}${s.finish ? `, ${s.finish}` : ""}`);
  }
  const roof = roofClause(structure, materials);
  if (roof) lines.push(roof);
  const light = materials.atmosphere;
  const neutralWalls = materials.surfaces.some((s) => /walls/.test(s.surface) && isNeutralWhite(s.colour));
  const parts = [`Apply these finishes to the existing surfaces only: ${lines.join("; ")}.`];
  parts.push(neutralLighting ? "Setting: neutral bright daylight with a light overcast sky." : `Setting: ${light.timeOfDay}, ${light.sky}.`);
  if (genericLandscape) parts.push("Landscape: simple lawn and a few shrubs.");
  else if (materials.landscape.groundCover || materials.landscape.hardscape) {
    parts.push(`Landscape: ${[materials.landscape.groundCover, materials.landscape.planting, materials.landscape.hardscape].filter(Boolean).join(", ")}.`);
  }

  const lock = [];
  if (variant === "locked") {
    const glass = structure.guardrails.filter((e) => KEEP.has(e.confidence) && e.kind === "glass_panel");
    if (glass.length) lock.push(`Guardrails drawn as glass (${glass.map((g) => g.location.replace(/_/g, " ")).join(", ")}) must stay clear frameless glass panels; never replace them with thin rails, cables or balusters.`);
    for (const g of structure.guardrails.filter((e) => KEEP.has(e.confidence))) {
      if (g.kind === "glass_panel") continue;
      else if (g.kind === "solid_parapet") lock.push(`The ${g.location} parapet stays a solid wall.`);
      else if (g.kind === "rail") lock.push(`The ${g.location} guardrail stays thin rails.`);
    }
    const repeated = [...new Set(structure.facadeElements.filter((x) => KEEP.has(x.confidence) && (x.count ?? 2) > 1 && ["fins", "columns", "pergola"].includes(x.kind)).map((x) => x.kind))];
    if (repeated.length) lock.push(`Keep the number, spacing and position of the ${repeated.join(" and ")} exactly as drawn; do not add, remove or merge any.`);
    if (structure.openings.some((x) => KEEP.has(x.confidence) && x.kind === "glazed_wall")) {
      lock.push("Glazed walls and window bands stay glass; do not turn glazing into solid panels or slats.");
    }
    if (neutralWalls) {
      lock.push("Walls must read as clean neutral white with no cream, beige or yellow tint; render under neutral daylight (about 5500K), not golden-hour or warm light.");
    }
    if (measuredPalette.length) lock.push(`Colour anchors measured from the reference: ${measuredPalette.join(", ")}.`);
    // A feature the reference has and the source ALSO has is not forbidden (BM-05: both have columns and a balcony).
    const sourceText = [...structure.volumes, ...structure.openings, ...structure.guardrails, ...structure.facadeElements].map((e) => e.kind + " " + e.description).join(" ").toLowerCase();
    const stem = (f) => f.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");
    const forbidden = materials.structuralFeaturesSeen.filter((f) => !sourceText.includes(stem(f)));
    if (forbidden.length) lock.push(`Never add any of these (they belong to the reference building, not this design): ${forbidden.join(", ")}.`);
  }
  return { finishes: parts.join(" "), lock: lock.join(" "), neutralWalls };
}

/** Scene text handed to the production prompt builder. */
export function composeScene(structure, materials, options) {
  const s = composeStructure(structure);
  const m = composeMaterials(structure, materials, options);
  const unknown = s.unknowns.length ? ` Where the drawing is unclear (${s.unknowns.slice(0, 4).join("; ")}) keep it simple and add nothing.` : "";
  return {
    text:
      `${m.finishes} Keep every element of the drawing exactly as it is - ${s.keep}.${unknown} ` +
      `${options.variant === "locked" ? "" : ""} ${m.lock} Do not add elements the drawing does not contain.`.replace(/\s+/g, " ").trim(),
    detail: { structure: s, materials: m },
  };
}
