import type { PlantDiagnosis, PlantDiagnosisResponse } from "@/lib/ai/schema";
import { prepareCapture } from "@/lib/image";
import type { Plant } from "@/lib/plants";
import { authHeaders } from "./account";
import { httpClient } from "./httpClient";

// "Mes plantes": a photo of a leaf or of the plant, checked by the AI
// (/api/plants/diagnose, one of the month's scans). The server reads the
// photo and forgets it; the app keeps the answer and a miniature with the plant.

export async function checkPlant(src: string, plant: Pick<Plant, "name" | "species" | "place">, locale: "fr" | "en"): Promise<{ diagnosis: PlantDiagnosis; demo: boolean; thumbnail: string }> {
  const { upload, thumbnail } = await prepareCapture(src);
  const response = await httpClient.post<PlantDiagnosisResponse>(
    "/api/plants/diagnose",
    { image: upload.base64, mediaType: upload.mediaType, locale, plant: (plant.species ?? plant.name).slice(0, 80), place: plant.place },
    { headers: await authHeaders() },
  );
  return { diagnosis: response.diagnosis, demo: response.demo, thumbnail: thumbnail.dataUrl };
}
