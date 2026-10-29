import { formatAriary } from "@/lib/format";
import type { Analysis, ExpenseSummary, ExpenseSummaryRequest, ScanMode, Statement } from "./schema";

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
    questions: ["Combien de temps ça se garde au frigo ?", "Une version sans feta ?", "C'est bon pour maigrir ?"],
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
    questions: ["How long does it keep in the fridge?", "A version without feta?", "Is it good for losing weight?"],
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
    questions: ["Qu'est-ce que je dois payer et quand ?", "Comment payer cette facture ?", "Ma consommation est-elle normale ?"],
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
      paper: null,
      bill: { issuer: null, kind: "electricity_water", amount: 84.2, currency: "EUR", period: "Août – Sept.", dueDate: null },
      registration: null,
      receipt: null,
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
    questions: ["What do I have to pay, and when?", "How do I pay this bill?", "Is my usage normal?"],
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
      paper: null,
      bill: { issuer: null, kind: "electricity_water", amount: 84.2, currency: "EUR", period: "Aug – Sept", dueDate: null },
      registration: null,
      receipt: null,
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
    questions: ["À quelle fréquence l'arroser ?", "Pourquoi ses feuilles jaunissent ?", "Est-ce toxique pour mon chat ?"],
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
    questions: ["How often should I water it?", "Why are its leaves turning yellow?", "Is it toxic to my cat?"],
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
    questions: ["Combien coûte l'entretien par an ?", "Quoi vérifier avant de l'acheter ?", "Quelle consommation en ville ?"],
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
    questions: ["How much is the yearly upkeep?", "What to check before buying it?", "What does it use in town?"],
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
    questions: ["Quand vais-je le recevoir ?", "Que veut dire ce statut ?", "Comment suivre ce colis ?"],
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
      shippingMode: "sea",
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
    questions: ["When will I get it?", "What does this status mean?", "How do I track this parcel?"],
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
      shippingMode: "sea",
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
    questions: ["Combien va coûter cette liste ?", "Que cuisiner avec ces courses ?", "J'oublie quelque chose ?"],
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
    questions: ["How much will this list cost?", "What can I cook with this?", "Am I forgetting something?"],
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

// Fictional registration certificate (plate and VIN made up) for demo mode.
const registrationScan: Record<Locale, Analysis> = {
  fr: {
    category: "document",
    title: "Carte grise Toyota Corolla",
    summary: "Le certificat d'immatriculation d'une Toyota Corolla essence, mise en circulation en mars 2019. Garde-le dans la voiture : il est demandé lors des contrôles.",
    confidence: 0.9,
    tags: ["carte grise", "voiture", "toyota"],
    facts: [
      { label: "Immatriculation", value: "1234 TBA" },
      { label: "Mise en circulation", value: "12/03/2019" },
      { label: "Puissance fiscale", value: "7 CV" },
    ],
    suggestions: [
      { kind: "action", title: "Ajoute-la à ton garage", detail: "Tu suivras l'assurance, la visite technique et les vidanges." },
      { kind: "tip", title: "Garde une copie", detail: "Une photo dans Mes papiers t'aide en cas de perte." },
    ],
    questions: ["Que veut dire la case P.6 ?", "Que faire si je vends la voiture ?", "Quand passer la visite technique ?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: "Carte grise",
      keyPoints: ["Toyota Corolla, essence", "Première mise en circulation le 12 mars 2019", "Puissance fiscale : 7 CV"],
      dates: [{ label: "Mise en circulation", date: "12 mars 2019" }],
      actionItems: ["Garder l'original dans le véhicule"],
      expiresOn: null,
      isInsurance: false,
      paper: "vehicle_registration",
      bill: null,
      registration: {
        plate: "1234 TBA",
        make: "Toyota",
        model: "Corolla",
        firstRegistration: "2019-03-12",
        vin: "JTDBR32E720000000",
        energy: "petrol",
        fiscalPower: 7,
      },
      receipt: null,
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  },
  en: {
    category: "document",
    title: "Toyota Corolla registration",
    summary: "The registration certificate of a petrol Toyota Corolla, first registered in March 2019. Keep it in the car: it is asked for at roadside checks.",
    confidence: 0.9,
    tags: ["registration", "car", "toyota"],
    facts: [
      { label: "Plate", value: "1234 TBA" },
      { label: "First registered", value: "12/03/2019" },
      { label: "Fiscal power", value: "7 CV" },
    ],
    suggestions: [
      { kind: "action", title: "Add it to your garage", detail: "You'll follow the insurance, the inspection and the oil changes." },
      { kind: "tip", title: "Keep a copy", detail: "A photo in My papers helps if you lose it." },
    ],
    questions: ["What does box P.6 mean?", "What do I do if I sell the car?", "When is the inspection due?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: "Registration certificate",
      keyPoints: ["Toyota Corolla, petrol", "First registered on 12 March 2019", "Fiscal power: 7 CV"],
      dates: [{ label: "First registered", date: "12 March 2019" }],
      actionItems: ["Keep the original in the vehicle"],
      expiresOn: null,
      isInsurance: false,
      paper: "vehicle_registration",
      bill: null,
      registration: {
        plate: "1234 TBA",
        make: "Toyota",
        model: "Corolla",
        firstRegistration: "2019-03-12",
        vin: "JTDBR32E720000000",
        energy: "petrol",
        fiscalPower: 7,
      },
      receipt: null,
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  },
};

// Fictional MVola confirmation (reference and names made up) for demo mode.
const mobileMoneyScan: Record<Locale, Analysis> = {
  fr: {
    category: "document",
    title: "Reçu MVola · Taxi Be Express",
    summary: "Une confirmation de paiement MVola de 15 000 Ar à Taxi Be Express le 20 octobre 2026, frais compris. Garde la référence : elle prouve le paiement en cas de litige.",
    confidence: 0.92,
    tags: ["mvola", "paiement", "transport"],
    facts: [
      { label: "Montant", value: "15 000 Ar" },
      { label: "Destinataire", value: "Taxi Be Express" },
      { label: "Référence", value: "MP261020.1432.A51234" },
    ],
    suggestions: [
      { kind: "action", title: "Ajoute-le à tes dépenses", detail: "Le montant, la date et la catégorie sont déjà remplis." },
      { kind: "tip", title: "Garde la référence", detail: "L'opérateur la demande pour toute réclamation." },
    ],
    questions: ["Combien de frais j'ai payés ?", "Comment annuler un transfert MVola ?", "Ce reçu suffit-il comme preuve ?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: "Reçu Mobile Money",
      keyPoints: ["Paiement MVola de 15 000 Ar", "Destinataire : Taxi Be Express", "Le 20 octobre 2026"],
      dates: [{ label: "Paiement", date: "20 octobre 2026" }],
      actionItems: [],
      expiresOn: null,
      isInsurance: false,
      paper: null,
      bill: null,
      registration: null,
      receipt: {
        total: 15000,
        currency: "MGA",
        date: "2026-10-20",
        merchant: "Taxi Be Express",
        payment: "mobile_money",
        operator: "mvola",
        category: "transport",
        reference: "MP261020.1432.A51234",
        direction: "out",
        fees: null,
        ownKind: null,
      },
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  },
  en: {
    category: "document",
    title: "MVola receipt · Taxi Be Express",
    summary: "An MVola payment confirmation of 15,000 Ar to Taxi Be Express on 20 October 2026, fees included. Keep the reference: it proves the payment if anything goes wrong.",
    confidence: 0.92,
    tags: ["mvola", "payment", "transport"],
    facts: [
      { label: "Amount", value: "15,000 Ar" },
      { label: "Recipient", value: "Taxi Be Express" },
      { label: "Reference", value: "MP261020.1432.A51234" },
    ],
    suggestions: [
      { kind: "action", title: "Add it to your expenses", detail: "The amount, the date and the category are already filled in." },
      { kind: "tip", title: "Keep the reference", detail: "The operator asks for it for any claim." },
    ],
    questions: ["How much did I pay in fees?", "How do I cancel an MVola transfer?", "Is this receipt enough as proof?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: "Mobile Money receipt",
      keyPoints: ["MVola payment of 15,000 Ar", "Recipient: Taxi Be Express", "On 20 October 2026"],
      dates: [{ label: "Payment", date: "20 October 2026" }],
      actionItems: [],
      expiresOn: null,
      isInsurance: false,
      paper: null,
      bill: null,
      registration: null,
      receipt: {
        total: 15000,
        currency: "MGA",
        date: "2026-10-20",
        merchant: "Taxi Be Express",
        payment: "mobile_money",
        operator: "mvola",
        category: "transport",
        reference: "MP261020.1432.A51234",
        direction: "out",
        fees: null,
        ownKind: null,
      },
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  },
};

// Fictional supermarket till receipt for demo mode.
const tillReceiptScan: Record<Locale, Analysis> = {
  fr: {
    category: "document",
    title: "Ticket de caisse · Supermarché Analakely",
    summary: "Un ticket de supermarché de 48 600 Ar payé en espèces le 18 octobre 2026 : riz, huile, sucre et savon.",
    confidence: 0.89,
    tags: ["ticket", "courses", "supermarché"],
    facts: [
      { label: "Total", value: "48 600 Ar" },
      { label: "Articles", value: "4" },
      { label: "Ticket", value: "N° 004512" },
    ],
    suggestions: [
      { kind: "action", title: "Ajoute-le à tes dépenses", detail: "Il ira dans la catégorie Marché, à changer si besoin." },
      { kind: "idea", title: "Compare avec le marché", detail: "Le riz en vrac au marché coûte souvent moins cher au kilo." },
    ],
    questions: ["Quel article coûte le plus cher ?", "Le riz est-il au bon prix ?", "Combien je dépense en courses par mois ?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: "Ticket de caisse",
      keyPoints: ["Riz 5 kg : 22 500 Ar", "Huile 1 L : 12 000 Ar", "Sucre 1 kg : 8 100 Ar", "Savon : 6 000 Ar"],
      dates: [{ label: "Achat", date: "18 octobre 2026" }],
      actionItems: [],
      expiresOn: null,
      isInsurance: false,
      paper: null,
      bill: null,
      registration: null,
      receipt: {
        total: 48600,
        currency: "MGA",
        date: "2026-10-18",
        merchant: "Supermarché Analakely",
        payment: "cash",
        operator: null,
        category: "market",
        reference: "004512",
        direction: "out",
        fees: null,
        ownKind: null,
      },
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  },
  en: {
    category: "document",
    title: "Till receipt · Analakely supermarket",
    summary: "A supermarket receipt of 48,600 Ar paid in cash on 18 October 2026: rice, oil, sugar and soap.",
    confidence: 0.89,
    tags: ["receipt", "groceries", "supermarket"],
    facts: [
      { label: "Total", value: "48,600 Ar" },
      { label: "Items", value: "4" },
      { label: "Receipt", value: "No. 004512" },
    ],
    suggestions: [
      { kind: "action", title: "Add it to your expenses", detail: "It goes under Market, change it if needed." },
      { kind: "idea", title: "Compare with the market", detail: "Loose rice at the market often costs less per kilo." },
    ],
    questions: ["Which item cost the most?", "Is the rice fairly priced?", "How much do I spend on groceries a month?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: "Till receipt",
      keyPoints: ["Rice 5 kg: 22,500 Ar", "Oil 1 L: 12,000 Ar", "Sugar 1 kg: 8,100 Ar", "Soap: 6,000 Ar"],
      dates: [{ label: "Purchase", date: "18 October 2026" }],
      actionItems: [],
      expiresOn: null,
      isInsurance: false,
      paper: null,
      bill: null,
      registration: null,
      receipt: {
        total: 48600,
        currency: "MGA",
        date: "2026-10-18",
        merchant: "Supermarché Analakely",
        payment: "cash",
        operator: null,
        category: "market",
        reference: "004512",
        direction: "out",
        fees: null,
        ownKind: null,
      },
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  },
};

// Fictional Mobile Money transfer received, for demo mode: money in, never an expense.
const received = (locale: Locale): Analysis => {
  const fr = locale === "fr";
  return {
    category: "document",
    title: fr ? "MVola reçu · Rasoa Hery" : "MVola received · Rasoa Hery",
    summary: fr
      ? "Tu as reçu 80 000 Ar par MVola de Rasoa Hery le 22 octobre 2026. Garde la référence : elle prouve le transfert."
      : "You received 80,000 Ar by MVola from Rasoa Hery on 22 October 2026. Keep the reference: it proves the transfer.",
    confidence: 0.9,
    tags: fr ? ["mvola", "reçu", "transfert"] : ["mvola", "received", "transfer"],
    facts: [
      { label: fr ? "Montant" : "Amount", value: fr ? "80 000 Ar" : "80,000 Ar" },
      { label: fr ? "De" : "From", value: "Rasoa Hery" },
      { label: fr ? "Référence" : "Reference", value: "MP261022.0915.B77310" },
    ],
    suggestions: [{ kind: "tip", title: fr ? "Compté dans tes revenus" : "Counted in your income", detail: fr ? "Il s'ajoute tout seul au mois." : "It is added to the month on its own." }],
    questions: fr ? ["Qui m'a envoyé cet argent ?", "Y a-t-il des frais ?"] : ["Who sent me this money?", "Are there any fees?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: fr ? "Reçu Mobile Money" : "Mobile Money receipt",
      keyPoints: fr ? ["80 000 Ar reçus par MVola", "De : Rasoa Hery"] : ["80,000 Ar received by MVola", "From: Rasoa Hery"],
      dates: [{ label: fr ? "Reçu" : "Received", date: fr ? "22 octobre 2026" : "22 October 2026" }],
      actionItems: [],
      expiresOn: null,
      isInsurance: false,
      paper: null,
      bill: null,
      registration: null,
      receipt: {
        total: 80000,
        currency: "MGA",
        date: "2026-10-22",
        merchant: "Rasoa Hery",
        payment: "mobile_money",
        operator: "mvola",
        category: null,
        reference: "MP261022.0915.B77310",
        direction: "in",
        fees: null,
        ownKind: null,
      },
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  };
};

// Fictional MVola cash withdrawal at an agent, for demo mode: money moved between one's own pockets, only the fees are spent.
const withdrawal = (locale: Locale): Analysis => {
  const fr = locale === "fr";
  return {
    category: "document",
    title: fr ? "Retrait MVola · Agent Analakely" : "MVola withdrawal · Analakely agent",
    summary: fr
      ? "Un retrait de 200 000 Ar en espèces chez un agent MVola le 21 octobre 2026, avec 2 600 Ar de frais. L'argent reste à toi : seuls les frais sont une dépense."
      : "A 200,000 Ar cash withdrawal at an MVola agent on 21 October 2026, with 2,600 Ar of fees. The money is still yours: only the fees are an expense.",
    confidence: 0.9,
    tags: fr ? ["mvola", "retrait", "espèces"] : ["mvola", "withdrawal", "cash"],
    facts: [
      { label: fr ? "Retiré" : "Withdrawn", value: fr ? "200 000 Ar" : "200,000 Ar" },
      { label: fr ? "Frais" : "Fees", value: fr ? "2 600 Ar" : "2,600 Ar" },
      { label: fr ? "Référence" : "Reference", value: "MP261021.1710.C40027" },
    ],
    suggestions: [{ kind: "tip", title: fr ? "Pas une dépense" : "Not an expense", detail: fr ? "Tu comptes ce que tu achètes avec ces espèces, pas le retrait." : "Count what you buy with this cash, not the withdrawal." }],
    questions: fr ? ["Combien coûtent les frais de retrait ?", "Où trouver un agent MVola ?"] : ["How much are withdrawal fees?", "Where is an MVola agent?"],
    nutrition: null,
    recipe: null,
    diet: null,
    document: {
      type: fr ? "Reçu Mobile Money" : "Mobile Money receipt",
      keyPoints: fr ? ["Retrait de 200 000 Ar", "Frais : 2 600 Ar"] : ["200,000 Ar withdrawal", "Fees: 2,600 Ar"],
      dates: [{ label: fr ? "Retrait" : "Withdrawal", date: fr ? "21 octobre 2026" : "21 October 2026" }],
      actionItems: [],
      expiresOn: null,
      isInsurance: false,
      paper: null,
      bill: null,
      registration: null,
      receipt: {
        total: 202600,
        currency: "MGA",
        date: "2026-10-21",
        merchant: fr ? "Agent MVola Analakely" : "MVola agent Analakely",
        payment: "mobile_money",
        operator: "mvola",
        category: null,
        reference: "MP261021.1710.C40027",
        direction: "own",
        fees: 2600,
        ownKind: "withdrawal",
      },
    },
    vehicle: null,
    parcel: null,
    list: null,
    reminder: null,
  };
};

/** The demo Mobile Money receipt (the end-to-end tests serve it in place of a scan): money paid, received, or withdrawn. */
export function mockReceipt(locale: Locale, direction: "out" | "in" | "own" = "out"): Analysis {
  return direction === "in" ? received(locale) : direction === "own" ? withdrawal(locale) : mobileMoneyScan[locale];
}

export function mockAnalysis(mode: ScanMode, locale: Locale): Analysis {
  if (mode !== "auto") return byMode[mode][locale];
  // New examples go last: tests rely on the order of the first ones.
  const pool = [food, documentScan, vehicleScan, objectScan, parcelScan, listScan, registrationScan, mobileMoneyScan, tillReceiptScan];
  const pick = pool[autoCursor % pool.length];
  autoCursor += 1;
  return pick[locale];
}

/** The demo receipt's reference: the sample statement has it too (one line "already there" once it is scanned or typed in). */
export const DEMO_RECEIPT_REFERENCE = "MP261020.1432.A51234";

/**
 * A sample MVola history of the last 12 days (names and references made up),
 * dated from `now` so it always falls in the current weeks: a salary, the
 * demo receipt's taxi ride, a withdrawal with its fees, a JIRAMA bill, phone
 * credit and help from the family.
 */
export function mockStatement(now: number): Statement {
  const day = (back: number) => {
    const date = new Date(now - back * 86_400_000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const none = { ownKind: null, fees: null, category: null, incomeKind: null };
  return {
    institution: "MVola",
    kind: "mobile_money",
    operator: "mvola",
    currency: "MGA",
    periodStart: day(12),
    periodEnd: day(1),
    closingBalance: 306_300,
    operations: [
      { ...none, date: day(12), amount: 250_000, direction: "in", side: "credit", counterparty: "SARL Vanille Export", reference: "MP-DEMO-0001", incomeKind: "salary", balanceAfter: 370_000 },
      { ...none, date: day(10), amount: 15_000, direction: "out", side: "debit", counterparty: "Taxi Be Express", reference: DEMO_RECEIPT_REFERENCE, category: "transport", balanceAfter: 355_000 },
      { ...none, date: day(8), amount: 50_000, direction: "own", side: "debit", ownKind: "withdrawal", counterparty: "Agent MVola Analakely", reference: "MP-DEMO-0003", fees: 1_200, balanceAfter: 303_800 },
      { ...none, date: day(6), amount: 32_500, direction: "out", side: "debit", counterparty: "JIRAMA", reference: "MP-DEMO-0004", category: "jirama", balanceAfter: 271_300 },
      { ...none, date: day(4), amount: 5_000, direction: "out", side: "debit", counterparty: "Telma", reference: "MP-DEMO-0005", category: "phone", balanceAfter: 266_300 },
      { ...none, date: day(1), amount: 40_000, direction: "in", side: "credit", counterparty: "Rakoto Jean", reference: "MP-DEMO-0006", incomeKind: "family", balanceAfter: 306_300 },
    ],
  };
}

/** A sample review of the month, built from the totals sent (demo mode). */
export function mockExpenseSummary(input: ExpenseSummaryRequest): ExpenseSummary {
  const fr = input.locale === "fr";
  const money = (value: number) => formatAriary(value, input.locale);
  const top = input.categories[0];
  const change = input.previousTotal > 0 ? Math.round(((input.total - input.previousTotal) / input.previousTotal) * 100) : null;
  const sign = change !== null && change > 0 ? "+" : "";
  const findings = [
    fr ? `Tu as dépensé ${money(input.total)} ce mois-ci.` : `You spent ${money(input.total)} this month.`,
    change === null
      ? fr
        ? "Pas de mois précédent pour comparer."
        : "No previous month to compare with."
      : fr
        ? `${sign}${change} % par rapport au mois dernier.`
        : `${sign}${change}% compared with last month.`,
    ...(top ? [fr ? `Ton plus gros poste : ${top.name}, ${money(top.amount)}.` : `Your biggest item: ${top.name}, ${money(top.amount)}.`] : []),
  ];
  const tips = fr
    ? ["Achète le riz et l'huile en gros au marché, une fois par mois.", "Mets de côté un petit montant dès que le salaire arrive, sur MVola ou un compte."]
    : ["Buy rice and oil in bulk at the market, once a month.", "Put a small amount aside as soon as the salary comes in, on MVola or an account."];
  return { findings, tips };
}
