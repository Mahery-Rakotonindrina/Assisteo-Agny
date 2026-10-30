import type { Analysis, PlantDiagnosis } from "./ai/schema";

// "Mes plantes": the user's plants, when to water them, and what was found
// when one had a problem. Pure, so it can be tested; stored and synced by
// services/plantStore.ts, reminded by services/plantReminders.ts.

export const plantPlaces = ["indoor", "outdoor"] as const;
export type PlantPlace = (typeof plantPlaces)[number];

/** A diagnosis kept with the plant: what the AI found on the photo of a leaf or of the plant. */
export type PlantCheck = PlantDiagnosis & { id: string; at: number; thumbnail?: string };

export type Plant = {
  id: string;
  name: string;
  /** The species named by the AI, when the plant came from a scan. */
  species?: string;
  /** Small JPEG data URL. */
  thumbnail?: string;
  place: PlantPlace;
  /** Watered every this many days. */
  waterEveryDays: number;
  lastWateredAt?: number;
  notes?: string;
  /** The scans it was made from or checked with. */
  scanIds: string[];
  /** Newest first. */
  checks: PlantCheck[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  dirty?: boolean;
};

export const DEFAULT_WATER_DAYS = 7;
export const MAX_WATER_DAYS = 60;
/** The morning reminder rings at 7:30, before the day's heat. */
export const WATER_HOUR = 7;
export const WATER_MINUTE = 30;
/** How many mornings are scheduled ahead (redone when the app opens and at each change). */
export const WATER_MORNINGS = 7;
/** At most this many checks are kept with a plant. */
export const MAX_CHECKS = 10;

/** A number of days typed or suggested: a whole number from 1 to 60, else the default. */
export function cleanWaterDays(value: number | undefined | null) {
  return value !== undefined && value !== null && Number.isFinite(value) && value >= 1 ? Math.min(MAX_WATER_DAYS, Math.round(value)) : DEFAULT_WATER_DAYS;
}

/** Madagascar's rainy season: November to April; the dry season from May to October. */
export function isRainySeason(at: number) {
  const month = new Date(at).getMonth();
  return month >= 10 || month <= 3;
}

/** The AI's watering for the season of `now`; the default for an older scan without it. */
export function suggestedWaterDays(info: Analysis["plant"] | undefined, now: number) {
  if (!info) return DEFAULT_WATER_DAYS;
  return cleanWaterDays(isRainySeason(now) ? info.waterEveryDaysRainy : info.waterEveryDaysDry);
}

/** What a plant scan fills in: its name, species, place and watering. */
export function plantFieldsFrom(analysis: Pick<Analysis, "title" | "plant">, now: number): Pick<Plant, "name" | "species" | "place" | "waterEveryDays"> {
  const name = analysis.title.trim().slice(0, 60);
  return {
    name,
    species: name || undefined,
    place: analysis.plant?.place ?? "indoor",
    waterEveryDays: suggestedWaterDays(analysis.plant, now),
  };
}

/** Midnight of the day containing `at`, local time. */
export const dayStart = (at: number) => {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const addDays = (day: number, days: number) => {
  const date = new Date(day);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
};

/** The day it is to be watered next: N days after the last watering; the day it was added when never watered. */
export function nextWaterDay(plant: Pick<Plant, "lastWateredAt" | "waterEveryDays" | "createdAt">) {
  return plant.lastWateredAt === undefined ? dayStart(plant.createdAt) : addDays(dayStart(plant.lastWateredAt), cleanWaterDays(plant.waterEveryDays));
}

/** Days until the next watering: 0 today, negative when late. */
export function daysUntilWater(plant: Pick<Plant, "lastWateredAt" | "waterEveryDays" | "createdAt">, now: number) {
  return Math.round((nextWaterDay(plant) - dayStart(now)) / 86_400_000);
}

export const needsWater = (plant: Pick<Plant, "lastWateredAt" | "waterEveryDays" | "createdAt">, now: number) => daysUntilWater(plant, now) <= 0;

export const wateredToday = (plant: Pick<Plant, "lastWateredAt">, now: number) => plant.lastWateredAt !== undefined && dayStart(plant.lastWateredAt) === dayStart(now);

/** To water first (the latest first), then the soonest to come, then by name. */
export function sortPlants<T extends Pick<Plant, "name" | "lastWateredAt" | "waterEveryDays" | "createdAt">>(plants: T[], now: number): T[] {
  return [...plants].sort((a, b) => daysUntilWater(a, now) - daysUntilWater(b, now) || a.name.localeCompare(b.name));
}

/** The key a morning is kept under on the device: its local day. */
export const morningKey = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/**
 * The mornings to ring, the soonest first: of the next 7 to come (this
 * morning included while its time hasn't passed), those with a plant to
 * water that day if not watered before, with their names. None without
 * the plan or the reminders.
 */
export function wateringMornings(plants: Array<Pick<Plant, "name" | "lastWateredAt" | "waterEveryDays" | "createdAt">>, now: number, enabled = true) {
  const mornings: Array<{ at: number; names: string[] }> = [];
  if (!enabled || plants.length === 0) return mornings;
  const today = new Date(now);
  for (let offset = 0, counted = 0; counted < WATER_MORNINGS; offset += 1) {
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, WATER_HOUR, WATER_MINUTE).getTime();
    if (at <= now) continue;
    counted += 1;
    const day = dayStart(at);
    const names = plants.filter((plant) => nextWaterDay(plant) <= day).map((plant) => plant.name);
    if (names.length > 0) mornings.push({ at, names });
  }
  return mornings;
}
