import type { EditEnvironment, EditSeason, EditStyle, EditTimeOfDay, EditWeather, FacadeMaterial } from "@renvia/types";

export interface EnvironmentOption<T extends string> {
  id: T;
  label: string;
}

export interface EnvironmentControl {
  key: keyof EditEnvironment;
  label: string;
  options: EnvironmentOption<string>[];
}

const TIMES_OF_DAY: EnvironmentOption<EditTimeOfDay>[] = [
  { id: "morning", label: "Morning" },
  { id: "midday", label: "Midday" },
  { id: "golden-hour", label: "Golden hour" },
  { id: "dusk", label: "Dusk" },
  { id: "night", label: "Night" },
];

const SEASONS: EnvironmentOption<EditSeason>[] = [
  { id: "spring", label: "Spring" },
  { id: "summer", label: "Summer" },
  { id: "autumn", label: "Autumn" },
  { id: "winter", label: "Winter" },
];

const WEATHER: EnvironmentOption<EditWeather>[] = [
  { id: "clear", label: "Clear sky" },
  { id: "overcast", label: "Overcast" },
  { id: "rain", label: "Rain" },
  { id: "snow", label: "Snow" },
  { id: "fog", label: "Fog" },
];

const LOOKS: EnvironmentOption<EditStyle>[] = [
  { id: "modern", label: "Modern" },
  { id: "minimalist", label: "Minimalist" },
  { id: "scandinavian", label: "Scandinavian" },
  { id: "mediterranean", label: "Mediterranean" },
  { id: "farmhouse", label: "Modern farmhouse" },
  { id: "industrial", label: "Industrial" },
  { id: "tropical", label: "Tropical" },
  { id: "classic", label: "Classic" },
];

const MATERIALS: EnvironmentOption<FacadeMaterial>[] = [
  { id: "brick", label: "Brick" },
  { id: "stone", label: "Stone" },
  { id: "stucco", label: "Stucco render" },
  { id: "timber", label: "Timber" },
  { id: "concrete", label: "Concrete" },
  { id: "metal", label: "Metal panels" },
  { id: "glass", label: "Glass" },
];

/** Facade colours are sent by name: image models follow a colour name far better than a hex value. */
const COLOURS: EnvironmentOption<string>[] = [
  { id: "warm white", label: "Warm white" },
  { id: "sand", label: "Sand" },
  { id: "terracotta", label: "Terracotta" },
  { id: "sage green", label: "Sage green" },
  { id: "slate blue", label: "Slate blue" },
  { id: "charcoal", label: "Charcoal" },
];

/** The Edit tab's environment rows, in the order they're shown. */
export const ENVIRONMENT_CONTROLS: EnvironmentControl[] = [
  { key: "timeOfDay", label: "Time of day", options: TIMES_OF_DAY },
  { key: "season", label: "Season", options: SEASONS },
  { key: "weather", label: "Weather", options: WEATHER },
  { key: "style", label: "Architectural look", options: LOOKS },
  { key: "facadeMaterial", label: "Facade material", options: MATERIALS },
  { key: "facadeColor", label: "Facade colour", options: COLOURS },
];

/** Plain-language names of the environment changes picked, e.g. ["Dusk", "Winter"]. */
export function environmentLabels(environment: EditEnvironment): string[] {
  return ENVIRONMENT_CONTROLS.flatMap(({ key, options }) => {
    const value = environment[key];
    if (!value) return [];
    return [options.find((option) => option.id === value)?.label ?? value];
  });
}
