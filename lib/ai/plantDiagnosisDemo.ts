import type { PlantDiagnosis } from "./schema";

// Demo mode (no AI key on the server, end-to-end tests): the diagnosis
// "found" on any photo, the most common problem of a houseplant.

export function mockPlantDiagnosis(locale: "fr" | "en"): PlantDiagnosis {
  return locale === "fr"
    ? {
        isPlant: true,
        healthy: false,
        problem: "Trop d’eau",
        cause: "Les feuilles qui jaunissent par le bas et la terre humide font penser à un excès d’arrosage. C’est probable, sans être certain sur une seule photo.",
        treatment: ["Laisse sécher la terre sur 3 cm avant d’arroser de nouveau.", "Vérifie que le pot a un trou et vide la soucoupe.", "Coupe les feuilles toutes jaunes."],
        urgency: "medium",
        note: "Si les tiges deviennent molles ou noires, demande conseil à une pépinière. (Diagnostic d’exemple, mode démo.)",
      }
    : {
        isPlant: true,
        healthy: false,
        problem: "Too much water",
        cause: "Leaves yellowing from the bottom and damp soil suggest overwatering. Likely, though not certain from one photo.",
        treatment: ["Let the top 3 cm of soil dry before watering again.", "Check the pot has a hole and empty the saucer.", "Cut off the fully yellow leaves."],
        urgency: "medium",
        note: "If the stems turn soft or black, ask a nursery. (Sample diagnosis, demo mode.)",
      };
}
