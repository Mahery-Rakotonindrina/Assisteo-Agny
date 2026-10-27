// Fictional users of Assisteo Agny: who they are, their plan and phone, and
// what they do in the app. run.mjs plays each one in a headless Edge and checks
// every step (errors, overflow, raw text keys, wrong language…).
//
// A step does one thing: `go` (open a path), `click` (a button, link, tab or
// FAQ question, by its visible text), `scan` ("document": pastes a page of
// text; demo AI only), `offline` (true/false) or `wait` (ms). It may add
// `expect` / `expectNot`: texts this user must (not) see afterwards, as shown (innerText:
// section titles styled in capitals read « MON OFFRE », not « Mon offre »).
// Labels are written for the owner, in French.
//
// Add a screen to SCREENS when one is created (e.g. "/plantes"), and a persona
// when a new kind of user matters.

/** The main screens, visited in order by personas with `tour: true`. */
export const SCREENS = [
  ["/", "Accueil (scan)"],
  ["/decouvrir", "Découvrir"],
  ["/result?example=food", "Exemple de résultat"],
  ["/history", "Historique"],
  ["/parcels", "Mes colis"],
  ["/lists", "Mes listes"],
  ["/papers", "Mes papiers"],
  ["/garage", "Mon garage"],
  ["/food", "Journal"],
  ["/plans", "Les offres"],
  ["/settings", "Réglages"],
  ["/privacy", "Confidentialité"],
  ["/terms", "Conditions"],
];

/**
 * plan: null = no account; "free" = an account without a plan; else
 * "lite" | "premium" | "pro" | "unlimited" (a throwaway account with that plan).
 * device: "mobile" (390 × 844) | "desktop" (1366 × 900).
 * network: "normal" | "3g". firstVisit: keeps the welcome screens.
 */
export const PERSONAS = [
  {
    id: "voahangy",
    name: "Voahangy, 34 ans, vendeuse à Antananarivo",
    who: "Découvre l'app par Google sur son Android, en 3G, sans compte.",
    plan: null,
    device: "mobile",
    locale: "fr",
    theme: "light",
    textSize: "normal",
    network: "3g",
    firstVisit: true,
    steps: [
      { label: "Arrive de Google sur la page Découvrir", go: "/decouvrir", expect: ["L’IA qui t’explique", "Essayer gratuitement"] },
      { label: "Ouvre la question « Faut-il créer un compte ? »", click: "Faut-il créer un compte ?", expect: ["Un compte, créé avec ton adresse e-mail"] },
      { label: "Touche « Essayer gratuitement »", click: "Essayer gratuitement", expect: ["Bienvenue !"] },
      { label: "Passe la présentation : « C’est parti »", click: "C’est parti" },
      { label: "Refuse l'appareil photo pour l'instant", click: "Plus tard" },
      { label: "Refuse les notifications pour l'instant", click: "Plus tard" },
      { label: "Termine la présentation", click: "Commencer", expectNot: ["Bienvenue !"] },
      { label: "Regarde l'exemple « Une facture »", click: "Une facture" },
      { label: "Revient à l'accueil", go: "/" },
      { label: "Scanne une facture", scan: "document" },
    ],
  },
  {
    id: "rado",
    name: "Rado, 21 ans, étudiant à Fianarantsoa",
    who: "Compte gratuit, petit forfait internet : il fait attention aux données et à l'essai gratuit.",
    plan: "free",
    device: "mobile",
    locale: "fr",
    theme: "dark",
    textSize: "normal",
    network: "3g",
    steps: [
      { label: "Ouvre l'app", go: "/" },
      { label: "Scanne un cours photocopié", scan: "document" },
      { label: "Va voir son historique", go: "/history", expect: ["Historique"] },
      { label: "Regarde ce que coûtent les offres", go: "/plans", expect: ["Les offres", "Lite", "Premium"] },
      { label: "Vérifie ses réglages", go: "/settings", expect: ["Réglages", "Choisir une offre"] },
      { label: "Ouvre « Mon garage » (réservé à Premium)", go: "/garage", expect: ["Mon garage", "Mon garage est inclus à partir de Premium.", "Premium"] },
    ],
  },
  {
    id: "rasoa",
    name: "Mme Rasoa, 67 ans, retraitée à Antsirabe",
    who: "Voit mal de près : texte très grand, thème clair, sans compte. Elle veut comprendre ses papiers.",
    plan: null,
    device: "mobile",
    locale: "fr",
    theme: "light",
    textSize: "xlarge",
    network: "normal",
    tour: true,
    steps: [{ label: "Ouvre « Mes papiers »", go: "/papers", expect: ["Mes papiers"] }],
  },
  {
    id: "fara",
    name: "Fara, 41 ans, mère de trois enfants à Mahajanga",
    who: "Premium pour la famille : repas, listes de courses, factures et rappels.",
    plan: "premium",
    device: "mobile",
    locale: "fr",
    theme: "dark",
    textSize: "large",
    network: "normal",
    steps: [
      { label: "Ouvre l'app", go: "/" },
      { label: "Ouvre le journal des repas", go: "/food", expect: ["Journal alimentaire"] },
      { label: "Ouvre ses listes", go: "/lists", expect: ["Mes listes"] },
      { label: "Ouvre ses papiers", go: "/papers", expect: ["Mes papiers"] },
      { label: "Ouvre son garage", go: "/garage", expect: ["Mon garage", "Ton garage est vide"], expectNot: ["Mon garage est inclus à partir de Premium."] },
      { label: "Ne voit pas « Mes dépenses » sur l'accueil (réservé à l'Admin pendant le test)", go: "/", expectNot: ["Mes dépenses"] },
      { label: "Ouvre /expenses à la main : « Pas disponible »", go: "/expenses", expect: ["Pas disponible"], expectNot: ["Ajouter une dépense"] },
      { label: "Vérifie son offre", go: "/settings", expect: ["Premium"] },
      { label: "Regarde la page des offres", go: "/plans", expect: ["Ton offre"] },
    ],
  },
  {
    id: "lalao",
    name: "Lalao, 37 ans, administratrice d'Assisteo Agny à Antananarivo",
    who: "Offre Admin, sur son ordinateur : elle teste « Mes dépenses », le budget du mois du foyer.",
    plan: "unlimited",
    device: "desktop",
    locale: "fr",
    theme: "light",
    textSize: "normal",
    network: "normal",
    steps: [
      { label: "Voit « Dépenses » dans le menu", go: "/", expect: ["Dépenses"] },
      { label: "Ouvre « Mes dépenses »", go: "/expenses", expect: ["Mes dépenses", "Dépensé", "Ajouter une dépense"] },
      { label: "Ouvre le formulaire d'ajout", click: "Ajouter une dépense", expect: ["Montant", "Catégorie", "Payé en"] },
      { label: "Regarde l'onglet Budget", go: "/expenses", click: "Budget", expect: ["Budget total"] },
    ],
  },
  {
    id: "hery",
    name: "Hery, 29 ans, revendeur de colis à Toamasina",
    who: "Pro : il commande en Chine pour ses clients et suit tous les colis.",
    plan: "pro",
    device: "mobile",
    locale: "fr",
    theme: "dark",
    textSize: "normal",
    network: "normal",
    steps: [
      { label: "Ouvre « Mes colis »", go: "/parcels", expect: ["Mes colis"] },
      { label: "Regarde son historique", go: "/history" },
      { label: "Vérifie son offre", go: "/settings", expect: ["Pro"] },
      { label: "Ouvre la page des offres", go: "/plans", expect: ["Ton offre"] },
    ],
  },
  {
    id: "john",
    name: "John, 45 ans, expatrié anglophone à Nosy Be",
    who: "Lite, sur son ordinateur, en anglais et en thème sombre.",
    plan: "lite",
    device: "desktop",
    locale: "en",
    theme: "dark",
    textSize: "normal",
    network: "normal",
    tour: true,
    steps: [],
  },
  {
    id: "miora",
    name: "Miora, 26 ans, comptable à Antananarivo",
    who: "Sans compte, sur l'ordinateur du bureau, thème clair : elle découvre l'app avant de l'installer.",
    plan: null,
    device: "desktop",
    locale: "fr",
    theme: "light",
    textSize: "normal",
    network: "normal",
    tour: true,
    steps: [{ label: "Clique « Découvrir tout ce que fait l'app » sur l'accueil", go: "/", click: "Découvrir tout ce que fait l’app", expect: ["L’IA qui t’explique"] }],
  },
  {
    id: "nirina",
    name: "Nirina, 38 ans, technicien en brousse près de Morondava",
    who: "Compte gratuit, réseau qui coupe : il scanne sans connexion et attend le retour du réseau.",
    plan: "free",
    device: "mobile",
    locale: "fr",
    theme: "dark",
    textSize: "normal",
    network: "normal",
    steps: [
      { label: "Ouvre l'app avec du réseau", go: "/" },
      { label: "Perd le réseau", offline: true },
      { label: "Scanne une fiche sans réseau (doit attendre)", scan: "document", offlineScan: true, expect: ["Pas de réseau pour l’instant"] },
      { label: "Ferme le message", click: "D’accord" },
      { label: "Retrouve le réseau", offline: false, wait: 15000 },
      { label: "Regarde son historique", go: "/history", expect: ["Historique"] },
    ],
  },
];
