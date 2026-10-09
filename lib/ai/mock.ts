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
    diet: {
      allergens: ["milk"],
      diets: [
        { diet: "vegetarian", fits: "yes" },
        { diet: "vegan", fits: "no" },
        { diet: "gluten_free", fits: "yes" },
        { diet: "lactose_free", fits: "no" },
        { diet: "halal", fits: "yes" },
        { diet: "low_sugar", fits: "yes" },
        { diet: "low_salt", fits: "unsure" },
      ],
      note: "La feta est salée et contient du lait : remplace-la par du tofu pour une version végane.",
    },
    document: null,
    vehicle: null,
    parcel: null,
    list: null,
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
    diet: {
      allergens: ["milk"],
      diets: [
        { diet: "vegetarian", fits: "yes" },
        { diet: "vegan", fits: "no" },
        { diet: "gluten_free", fits: "yes" },
        { diet: "lactose_free", fits: "no" },
        { diet: "halal", fits: "yes" },
        { diet: "low_sugar", fits: "yes" },
        { diet: "low_salt", fits: "unsure" },
      ],
      note: "Feta is salty and contains milk: swap it for tofu for a vegan version.",
    },
    document: null,
    vehicle: null,
    parcel: null,
    list: null,
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
    diet: null,
    document: {
      type: "Facture",
      keyPoints: ["Paiement par prélèvement", "Consommation en légère baisse", "Abonnement 6 kVA"],
      dates: [{ label: "Échéance", date: "15 octobre" }],
      actionItems: ["Vérifier le solde du compte avant le prélèvement"],
      expiresOn: null,
      isInsurance: false,
    },
    vehicle: null,
    parcel: null,
    list: null,
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
    diet: null,
    document: {
      type: "Bill",
      keyPoints: ["Paid by direct debit", "Usage slightly down", "6 kVA subscription"],
      dates: [{ label: "Due date", date: "October 15" }],
      actionItems: ["Check the account balance before the debit"],
      expiresOn: null,
      isInsurance: false,
    },
    vehicle: null,
    parcel: null,
    list: null,
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
    diet: null,
    document: null,
    vehicle: null,
    parcel: null,
    list: null,
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
    diet: null,
    document: null,
    vehicle: null,
    parcel: null,
    list: null,
    reminder: { title: "Water the Monstera", body: "Check the soil and water if it is dry.", delayHours: 168 },
  },
};

const vehicleScan: Record<Locale, Analysis> = {
  fr: {
    category: "vehicle",
    title: "Toyota Corolla Hybride",
    summary:
      "Une berline compacte Toyota Corolla hybride de 12e génération, reconnaissable à sa calandre et ses optiques. C'est une voiture réputée fiable et sobre en ville. Les prix ci-dessous sont des ordres de grandeur.",
    confidence: 0.84,
    tags: ["voiture", "hybride", "toyota", "berline"],
    facts: [
      { label: "Génération", value: "E210 (2019–2024)" },
      { label: "Carburant", value: "Essence hybride" },
      { label: "Consommation", value: "≈ 4,5 L/100 km" },
    ],
    suggestions: [
      { kind: "tip", title: "Roule souvent en ville", detail: "C'est là que l'hybride consomme le moins : le moteur électrique prend le relais." },
      { kind: "warning", title: "Contrôle la batterie auxiliaire", detail: "Une batterie 12 V faible empêche le démarrage du système hybride." },
    ],
    nutrition: null,
    recipe: null,
    diet: null,
    document: null,
    vehicle: {
      make: "Toyota",
      model: "Corolla Hybride",
      generation: "E210 (2019–2024)",
      kind: "Berline compacte",
      priceNew: "30 000 – 38 000 €",
      priceUsed: "15 000 – 24 000 € selon l'année et le kilométrage",
      specs: [
        { label: "Moteur", value: "1.8 L hybride" },
        { label: "Puissance", value: "122 ch" },
        { label: "Boîte", value: "Automatique e-CVT" },
        { label: "Consommation", value: "4,3 – 5 L/100 km" },
        { label: "Places", value: "5" },
        { label: "Coffre", value: "361 L" },
      ],
      maintenance: [
        { task: "Vidange moteur", interval: "15 000 km ou 1 an" },
        { task: "Filtre à air d'habitacle", interval: "15 000 km ou 1 an" },
        { task: "Liquide de frein", interval: "Tous les 2 ans" },
        { task: "Contrôle du système hybride", interval: "À chaque révision" },
      ],
      tips: [
        "Garde la garantie hybride active en faisant les révisions dans le réseau.",
        "Nettoie la grille d'aération de la batterie hybride sous la banquette arrière.",
      ],
      watchOuts: [
        "Avant d'acheter, demande l'historique d'entretien complet.",
        "Vérifie l'état de la batterie 12 V et l'absence de voyant hybride.",
      ],
    },
    parcel: null,
    list: null,
    reminder: { title: "Révision de la Corolla", body: "Pense à vérifier la date de ta prochaine révision.", delayHours: 720 },
  },
  en: {
    category: "vehicle",
    title: "Toyota Corolla Hybrid",
    summary:
      "A 12th-generation Toyota Corolla hybrid compact saloon, recognisable by its grille and lights. It has a reputation for reliability and low fuel use in town. Prices below are rough ranges.",
    confidence: 0.84,
    tags: ["car", "hybrid", "toyota", "saloon"],
    facts: [
      { label: "Generation", value: "E210 (2019–2024)" },
      { label: "Fuel", value: "Petrol hybrid" },
      { label: "Consumption", value: "≈ 4.5 L/100 km" },
    ],
    suggestions: [
      { kind: "tip", title: "Drive in town", detail: "That's where the hybrid uses the least fuel: the electric motor takes over." },
      { kind: "warning", title: "Check the auxiliary battery", detail: "A weak 12 V battery stops the hybrid system from starting." },
    ],
    nutrition: null,
    recipe: null,
    diet: null,
    document: null,
    vehicle: {
      make: "Toyota",
      model: "Corolla Hybrid",
      generation: "E210 (2019–2024)",
      kind: "Compact saloon",
      priceNew: "€30,000 – €38,000",
      priceUsed: "€15,000 – €24,000 depending on year and mileage",
      specs: [
        { label: "Engine", value: "1.8 L hybrid" },
        { label: "Power", value: "122 hp" },
        { label: "Gearbox", value: "Automatic e-CVT" },
        { label: "Consumption", value: "4.3 – 5 L/100 km" },
        { label: "Seats", value: "5" },
        { label: "Boot", value: "361 L" },
      ],
      maintenance: [
        { task: "Oil change", interval: "15,000 km or 1 year" },
        { task: "Cabin air filter", interval: "15,000 km or 1 year" },
        { task: "Brake fluid", interval: "Every 2 years" },
        { task: "Hybrid system check", interval: "At every service" },
      ],
      tips: [
        "Keep the hybrid warranty active by servicing at the dealer network.",
        "Clean the hybrid battery air vent under the rear seat.",
      ],
      watchOuts: [
        "Before buying, ask for the full service history.",
        "Check the 12 V battery and that no hybrid warning light is on.",
      ],
    },
    parcel: null,
    list: null,
    reminder: { title: "Corolla service", body: "Remember to check when your next service is due.", delayHours: 720 },
  },
};

const byMode: Record<Exclude<ScanMode, "auto">, Record<Locale, Analysis>> = {
  food,
  document: documentScan,
  vehicle: vehicleScan,
  object: objectScan,
};

let autoCursor = 0;


// Fictional order (numbers made up) for demo mode.
const parcelScan: Record<Locale, Analysis> = {
  fr: {
    category: "parcel",
    title: "Casque moto effet carbone",
    summary: "Une commande Pinduoduo en transit avec STO Express. Le colis a été pris en charge par l'agence de Zhaoqing et se dirige vers Foshan.",
    confidence: 0.93,
    tags: ["colis", "commande", "suivi"],
    facts: [
      { label: "Transporteur", value: "STO Express" },
      { label: "Statut", value: "En transit" },
      { label: "Montant payé", value: "¥221,45" },
    ],
    suggestions: [
      { kind: "tip", title: "Suis le colis en ligne", detail: "Le numéro de suivi fonctionne aussi sur les sites de suivi multi-transporteurs." },
      { kind: "action", title: "Vérifie à la réception", detail: "Retours gratuits sous 7 jours : ouvre le colis rapidement pour vérifier la taille et l'état." },
    ],
    nutrition: null,
    recipe: null,
    diet: null,
    document: null,
    vehicle: null,
    parcel: {
      platform: "Pinduoduo",
      orderNumber: "260101-000000000000001",
      trackingNumber: "770000000000001",
      carrier: "STO Express",
      status: "in_transit",
      statusLabel: "En transit",
      lastEvent: { description: "Pris en charge par l'agence de Zhaoqing", location: "Zhaoqing, Guangdong", at: "2026-10-07 17:21" },
      items: [{ name: "Casque moto effet carbone avec visière", variant: "Noir brillant, visière bleue, taille M", quantity: 1, price: "¥215" }],
      total: "¥221,45",
      seller: "Boutique Équipement Moto",
      orderedAt: "2026-10-06",
      shippedAt: "2026-10-07",
      estimatedDelivery: null,
      destinationCity: "Foshan",
    },
    list: null,
    reminder: null,
  },
  en: {
    category: "parcel",
    title: "Carbon-look motorbike helmet",
    summary: "A Pinduoduo order in transit with STO Express. The parcel was picked up by the Zhaoqing depot and is heading to Foshan.",
    confidence: 0.93,
    tags: ["parcel", "order", "tracking"],
    facts: [
      { label: "Carrier", value: "STO Express" },
      { label: "Status", value: "In transit" },
      { label: "Paid", value: "¥221.45" },
    ],
    suggestions: [
      { kind: "tip", title: "Track it online", detail: "The tracking number also works on multi-carrier tracking sites." },
      { kind: "action", title: "Check it on arrival", detail: "Free returns within 7 days: open the parcel quickly to check the size and condition." },
    ],
    nutrition: null,
    recipe: null,
    diet: null,
    document: null,
    vehicle: null,
    parcel: {
      platform: "Pinduoduo",
      orderNumber: "260101-000000000000001",
      trackingNumber: "770000000000001",
      carrier: "STO Express",
      status: "in_transit",
      statusLabel: "In transit",
      lastEvent: { description: "Picked up by the Zhaoqing depot", location: "Zhaoqing, Guangdong", at: "2026-10-07 17:21" },
      items: [{ name: "Carbon-look motorbike helmet with visor", variant: "Gloss black, blue visor, size M", quantity: 1, price: "¥215" }],
      total: "¥221.45",
      seller: "Moto Gear Shop",
      orderedAt: "2026-10-06",
      shippedAt: "2026-10-07",
      estimatedDelivery: null,
      destinationCity: "Foshan",
    },
    list: null,
    reminder: null,
  },
};

// A fictional shopping list for demo mode.
const listScan: Record<Locale, Analysis> = {
  fr: {
    category: "list",
    title: "Courses de la semaine",
    summary: "Une liste de courses écrite à la main : 7 articles, dont un déjà barré.",
    confidence: 0.9,
    tags: ["courses", "liste", "marché"],
    facts: [{ label: "Articles", value: "7" }],
    suggestions: [{ kind: "tip", title: "Garde-la dans Mes listes", detail: "Coche les articles au fur et à mesure au marché." }],
    nutrition: null,
    recipe: null,
    diet: null,
    document: null,
    vehicle: null,
    parcel: null,
    list: {
      kind: "shopping",
      items: [
        { text: "Riz", quantity: "5 kg", done: false },
        { text: "Huile", quantity: "1 L", done: false },
        { text: "Tomates", quantity: "1 kg", done: false },
        { text: "Oignons", quantity: null, done: false },
        { text: "Brèdes mafana", quantity: "2 bottes", done: false },
        { text: "Sucre", quantity: "1 kg", done: true },
        { text: "Savon", quantity: "x3", done: false },
      ],
    },
    reminder: null,
  },
  en: {
    category: "list",
    title: "This week's shopping",
    summary: "A handwritten shopping list: 7 items, one already crossed out.",
    confidence: 0.9,
    tags: ["shopping", "list", "market"],
    facts: [{ label: "Items", value: "7" }],
    suggestions: [{ kind: "tip", title: "Keep it in My lists", detail: "Tick the items off as you go at the market." }],
    nutrition: null,
    recipe: null,
    diet: null,
    document: null,
    vehicle: null,
    parcel: null,
    list: {
      kind: "shopping",
      items: [
        { text: "Rice", quantity: "5 kg", done: false },
        { text: "Oil", quantity: "1 L", done: false },
        { text: "Tomatoes", quantity: "1 kg", done: false },
        { text: "Onions", quantity: null, done: false },
        { text: "Mafana greens", quantity: "2 bunches", done: false },
        { text: "Sugar", quantity: "1 kg", done: true },
        { text: "Soap", quantity: "x3", done: false },
      ],
    },
    reminder: null,
  },
};

export function mockAnalysis(mode: ScanMode, locale: Locale): Analysis {
  if (mode !== "auto") return byMode[mode][locale];
  // New examples go last: tests rely on the order of the first ones.
  const pool = [food, documentScan, vehicleScan, objectScan, parcelScan, listScan];
  const pick = pool[autoCursor % pool.length];
  autoCursor += 1;
  return pick[locale];
}
