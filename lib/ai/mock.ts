import type { Analysis, ScanMode } from "./schema";

// Demo-mode analyses, used when no Claude API key is configured so the whole
// flow (camera → analysis → history → reminders) can be tried end to end.

type Locale = "fr" | "en";

const food: Record<Locale, Analysis> = {
  fr: {
    category: "food",
    title: "Bol de salade composée",
    summary:
      "Une salade avec avocat, tomates cerises, pois chiches et feta. C'est un repas équilibré, riche en fibres et en bonnes graisses. Les valeurs ci-dessous sont une estimation pour la portion visible.",
    confidence: 0.86,
    tags: ["salade", "avocat", "végétarien", "déjeuner"],
    facts: [
      { label: "Portion", value: "≈ 350 g" },
      { label: "Fibres", value: "≈ 11 g" },
      { label: "Index glycémique", value: "Bas" },
      { label: "Régime", value: "Végétarien" },
    ],
    suggestions: [
      { kind: "tip", title: "Ajoute une source de protéines", detail: "Un œuf mollet ou du poulet grillé rendrait ce repas plus rassasiant." },
      { kind: "action", title: "Assaisonne au dernier moment", detail: "La vinaigrette ramollit les feuilles : garde-la à part si tu emportes la salade." },
      { kind: "warning", title: "Avocat coupé", detail: "Il s'oxyde vite. Un filet de citron le garde vert quelques heures de plus." },
    ],
    nutrition: { portion: "Bol de ≈ 350 g", calories: 480, proteinG: 16, carbsG: 32, fatG: 31 },
    recipe: {
      name: "Buddha bowl avocat, pois chiches et feta",
      servings: 2,
      prepMinutes: 15,
      cookMinutes: 10,
      difficulty: "easy",
      ingredients: [
        { name: "Pois chiches cuits", quantity: "240 g" },
        { name: "Paprika fumé", quantity: "1 c. à café" },
        { name: "Huile d'olive", quantity: "3 c. à soupe" },
        { name: "Jeunes pousses de salade", quantity: "100 g" },
        { name: "Tomates cerises", quantity: "150 g" },
        { name: "Avocat mûr", quantity: "1" },
        { name: "Feta", quantity: "80 g" },
        { name: "Citron", quantity: "½" },
      ],
      steps: [
        "Égoutte et sèche les pois chiches, puis mélange-les avec 1 c. à soupe d'huile et le paprika.",
        "Fais-les dorer 10 min à la poêle à feu moyen, jusqu'à ce qu'ils soient croustillants.",
        "Coupe les tomates cerises en deux et l'avocat en tranches, puis arrose l'avocat de citron.",
        "Fouette le reste de l'huile avec le jus de citron, du sel et du poivre.",
        "Répartis les pousses dans deux bols, ajoute les légumes, les pois chiches tièdes et la feta émiettée.",
        "Assaisonne juste avant de servir.",
      ],
      tip: "Prépare les pois chiches en double : ils se gardent 3 jours en bocal et font un super snack.",
    },
    document: null,
    reminder: { title: "Salade au frigo", body: "Pense à finir ta salade avant demain soir.", delayHours: 24 },
  },
  en: {
    category: "food",
    title: "Mixed salad bowl",
    summary:
      "A salad with avocado, cherry tomatoes, chickpeas and feta. It is a balanced meal, high in fibre and healthy fats. The values below are an estimate for the visible portion.",
    confidence: 0.86,
    tags: ["salad", "avocado", "vegetarian", "lunch"],
    facts: [
      { label: "Portion", value: "≈ 350 g" },
      { label: "Fibre", value: "≈ 11 g" },
      { label: "Glycemic index", value: "Low" },
      { label: "Diet", value: "Vegetarian" },
    ],
    suggestions: [
      { kind: "tip", title: "Add a protein source", detail: "A soft-boiled egg or grilled chicken would make it more filling." },
      { kind: "action", title: "Dress it at the last minute", detail: "Dressing wilts the leaves: keep it separate if you take the salad to go." },
      { kind: "warning", title: "Cut avocado", detail: "It browns quickly. A squeeze of lemon keeps it green for a few more hours." },
    ],
    nutrition: { portion: "≈ 350 g bowl", calories: 480, proteinG: 16, carbsG: 32, fatG: 31 },
    recipe: {
      name: "Avocado, chickpea and feta buddha bowl",
      servings: 2,
      prepMinutes: 15,
      cookMinutes: 10,
      difficulty: "easy",
      ingredients: [
        { name: "Cooked chickpeas", quantity: "240 g" },
        { name: "Smoked paprika", quantity: "1 tsp" },
        { name: "Olive oil", quantity: "3 tbsp" },
        { name: "Baby salad leaves", quantity: "100 g" },
        { name: "Cherry tomatoes", quantity: "150 g" },
        { name: "Ripe avocado", quantity: "1" },
        { name: "Feta", quantity: "80 g" },
        { name: "Lemon", quantity: "½" },
      ],
      steps: [
        "Drain and pat the chickpeas dry, then toss them with 1 tbsp oil and the paprika.",
        "Pan-fry for 10 min over medium heat until crisp.",
        "Halve the cherry tomatoes and slice the avocado, then squeeze lemon over the avocado.",
        "Whisk the remaining oil with the lemon juice, salt and pepper.",
        "Divide the leaves between two bowls and add the vegetables, warm chickpeas and crumbled feta.",
        "Dress just before serving.",
      ],
      tip: "Make a double batch of chickpeas: they keep for 3 days in a jar and make a great snack.",
    },
    document: null,
    reminder: { title: "Salad in the fridge", body: "Remember to finish your salad before tomorrow night.", delayHours: 24 },
  },
};

const documentScan: Record<Locale, Analysis> = {
  fr: {
    category: "document",
    title: "Facture d'électricité",
    summary:
      "Une facture d'énergie pour la période de août à septembre. Le montant est à régler par prélèvement, avec une date limite visible en bas de page.",
    confidence: 0.91,
    tags: ["facture", "énergie", "paiement"],
    facts: [
      { label: "Montant", value: "84,20 €" },
      { label: "Période", value: "Août – Sept." },
      { label: "Consommation", value: "312 kWh" },
    ],
    suggestions: [
      { kind: "action", title: "Vérifie le relevé", detail: "Compare l'index du compteur avec ton relevé réel pour éviter une estimation." },
      { kind: "idea", title: "Compare les offres", detail: "Ta consommation est stable : une offre heures creuses pourrait être plus avantageuse." },
    ],
    nutrition: null,
    recipe: null,
    document: {
      type: "Facture",
      keyPoints: ["Paiement par prélèvement", "Consommation en légère baisse", "Abonnement 6 kVA"],
      dates: [{ label: "Échéance", date: "15 octobre" }],
      actionItems: ["Vérifier le solde du compte avant le prélèvement"],
    },
    reminder: { title: "Facture d'électricité", body: "Le prélèvement de 84,20 € arrive bientôt.", delayHours: 72 },
  },
  en: {
    category: "document",
    title: "Electricity bill",
    summary:
      "An energy bill covering August to September. It is paid by direct debit, with a due date visible at the bottom of the page.",
    confidence: 0.91,
    tags: ["bill", "energy", "payment"],
    facts: [
      { label: "Amount", value: "€84.20" },
      { label: "Period", value: "Aug – Sept" },
      { label: "Usage", value: "312 kWh" },
    ],
    suggestions: [
      { kind: "action", title: "Check the meter reading", detail: "Compare the reading with your actual meter to avoid an estimated bill." },
      { kind: "idea", title: "Compare plans", detail: "Your usage is steady: an off-peak plan could cost less." },
    ],
    nutrition: null,
    recipe: null,
    document: {
      type: "Bill",
      keyPoints: ["Paid by direct debit", "Usage slightly down", "6 kVA subscription"],
      dates: [{ label: "Due date", date: "October 15" }],
      actionItems: ["Check the account balance before the debit"],
    },
    reminder: { title: "Electricity bill", body: "The €84.20 direct debit is coming up.", delayHours: 72 },
  },
};

const objectScan: Record<Locale, Analysis> = {
  fr: {
    category: "plant",
    title: "Monstera deliciosa",
    summary:
      "Une plante d'intérieur tropicale reconnaissable à ses feuilles découpées. Elle a l'air en bonne santé, mais quelques feuilles jaunissent légèrement sur les bords.",
    confidence: 0.78,
    tags: ["plante", "intérieur", "tropical"],
    facts: [
      { label: "Lumière", value: "Vive, indirecte" },
      { label: "Arrosage", value: "1× / semaine" },
      { label: "Toxicité", value: "Toxique (animaux)" },
    ],
    suggestions: [
      { kind: "tip", title: "Laisse sécher la terre", detail: "Arrose quand les 3 premiers centimètres sont secs : les bords jaunes signalent souvent un excès d'eau." },
      { kind: "warning", title: "Attention aux animaux", detail: "Les feuilles sont irritantes pour les chats et les chiens." },
      { kind: "idea", title: "Ajoute un tuteur", detail: "Un tuteur en mousse l'aidera à produire de plus grandes feuilles." },
    ],
    nutrition: null,
    recipe: null,
    document: null,
    reminder: { title: "Arroser le Monstera", body: "Vérifie la terre et arrose si elle est sèche.", delayHours: 168 },
  },
  en: {
    category: "plant",
    title: "Monstera deliciosa",
    summary:
      "A tropical houseplant recognisable by its split leaves. It looks healthy, though a few leaves are yellowing slightly at the edges.",
    confidence: 0.78,
    tags: ["plant", "indoor", "tropical"],
    facts: [
      { label: "Light", value: "Bright, indirect" },
      { label: "Watering", value: "Once a week" },
      { label: "Toxicity", value: "Toxic to pets" },
    ],
    suggestions: [
      { kind: "tip", title: "Let the soil dry", detail: "Water when the top 3 cm are dry: yellow edges often mean overwatering." },
      { kind: "warning", title: "Keep away from pets", detail: "The leaves irritate cats and dogs." },
      { kind: "idea", title: "Add a moss pole", detail: "A pole helps it grow larger leaves." },
    ],
    nutrition: null,
    recipe: null,
    document: null,
    reminder: { title: "Water the Monstera", body: "Check the soil and water if it is dry.", delayHours: 168 },
  },
};

const byMode: Record<Exclude<ScanMode, "auto">, Record<Locale, Analysis>> = {
  food,
  document: documentScan,
  object: objectScan,
};

let autoCursor = 0;

export function mockAnalysis(mode: ScanMode, locale: Locale): Analysis {
  if (mode !== "auto") return byMode[mode][locale];
  const pool = [food, documentScan, objectScan];
  const pick = pool[autoCursor % pool.length];
  autoCursor += 1;
  return pick[locale];
}
