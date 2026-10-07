import type { Locale } from "@/i18n.config";

// Privacy policy and terms of use. Kept in code rather than in the locale
// files: they are long, structured, and must stay in sync with what the app
// actually does (see the README section "Données et confidentialité").

export type LegalBlock = string | { list: string[] };
export type LegalSection = { heading: string; body: LegalBlock[] };
export type LegalDocument = { title: string; intro: string; sections: LegalSection[] };
export type LegalKind = "privacy" | "terms";

/** Date of the last change, shown on both documents. */
export const LEGAL_UPDATED_AT = "2026-10-07";

const privacyFr: LegalDocument = {
  title: "Politique de confidentialité",
  intro:
    "Assisteo Agny analyse les photos que tu prends pour t’en dire l’essentiel. Cette page explique quelles données passent par l’app, où elles vont et comment les supprimer.",
  sections: [
    {
      heading: "Les données que l’app utilise",
      body: [
        {
          list: [
            "Les photos que tu choisis d’analyser, et les questions que tu poses ensuite sur un scan.",
            "Le résultat des analyses et ton historique.",
            "Si tu crées un compte : ton adresse e-mail, ton historique avec les photos, tes réglages et, si tu en ajoutes une, ta clé API (chiffrée).",
            "Un identifiant d’installation aléatoire et ton adresse IP, uniquement pour compter les scans gratuits et limiter les abus.",
            "Des compteurs anonymes et regroupés par jour (nombre d’analyses par type, de questions, d’erreurs, estimation du nombre d’appareils actifs) pour suivre le bon fonctionnement de l’app. Ils ne contiennent ni photo, ni texte, ni identifiant, et s’effacent au bout de 120 jours.",
            "Si tu dis qu’une réponse est juste ou fausse : ton avis, la raison choisie, le titre et le type de l’analyse, sans la photo ni ton identité.",
          ],
        },
        "L’app ne collecte ni ta position, ni tes contacts, et n’affiche aucune publicité. Tes données ne sont jamais vendues.",
      ],
    },
    {
      heading: "Où partent tes photos",
      body: [
        "Pour être analysée, une photo est envoyée à un service d’intelligence artificielle :",
        {
          list: [
            "par défaut, Google Gemini. Avec l’offre gratuite de Gemini, Google peut utiliser les contenus envoyés pour améliorer ses services, et des personnes peuvent les relire. N’analyse pas de documents contenant des informations très sensibles si cela te pose problème ;",
            "si tu ajoutes ta propre clé API, le fournisseur que tu as choisi (Anthropic, Google, OpenAI ou un autre) selon ses propres conditions.",
          ],
        },
        "Notre serveur transmet la photo à l’IA puis l’oublie : il ne la conserve pas.",
      ],
    },
    {
      heading: "Où sont stockées tes données",
      body: [
        {
          list: [
            "Sans compte : l’historique et les photos restent uniquement sur ton appareil.",
            "Avec un compte : ils sont aussi stockés chez Supabase (base de données et stockage de fichiers) pour être synchronisés entre tes appareils. Chaque compte n’a accès qu’à ses propres données.",
            "Ta clé API personnelle est chiffrée (AES-256) avant d’être enregistrée, et seul ton compte peut la récupérer.",
            "Le site et l’API sont hébergés par Vercel ; les compteurs de l’essai gratuit sont stockés chez Upstash.",
          ],
        },
      ],
    },
    {
      heading: "Combien de temps",
      body: [
        {
          list: [
            "Ton historique est gardé jusqu’à ce que tu le supprimes, ou que tu supprimes ton compte.",
            "Le compteur lié à l’adresse IP s’efface au bout de 30 jours ; celui des questions, au bout de 2 jours.",
            "Les journaux techniques de l’hébergeur sont conservés quelques jours.",
          ],
        },
      ],
    },
    {
      heading: "Notifications et autorisations",
      body: [
        "L’appareil photo n’est utilisé que lorsque tu prends une photo. Les rappels sont des notifications programmées sur ton téléphone ; tu peux couper les autorisations à tout moment dans les réglages du téléphone.",
      ],
    },
    {
      heading: "Tes droits",
      body: [
        "Tu peux à tout moment :",
        {
          list: [
            "supprimer un scan, ou tout l’historique, depuis l’app ;",
            "supprimer ton compte et toutes ses données depuis Réglages → Compte → Supprimer mon compte ;",
            "demander une copie de tes données ou poser une question en nous écrivant.",
          ],
        },
      ],
    },
    {
      heading: "Âge minimum",
      body: ["L’app n’est pas destinée aux enfants de moins de 13 ans."],
    },
    {
      heading: "Modifications",
      body: ["Si cette politique change, la date en haut de la page est mise à jour et les changements importants sont signalés dans l’app."],
    },
  ],
};

const privacyEn: LegalDocument = {
  title: "Privacy policy",
  intro:
    "Assisteo Agny analyses the photos you take and tells you what matters about them. This page explains which data goes through the app, where it goes and how to delete it.",
  sections: [
    {
      heading: "Data the app uses",
      body: [
        {
          list: [
            "The photos you choose to analyse, and the follow-up questions you ask about a scan.",
            "Analysis results and your history.",
            "If you create an account: your e-mail address, your history with its photos, your settings and, if you add one, your API key (encrypted).",
            "A random installation id and your IP address, only to count free scans and prevent abuse.",
            "Anonymous counters grouped by day (number of analyses by type, questions, errors, an estimate of active devices) to keep an eye on how the app works. They hold no photo, text or identifier, and are erased after 120 days.",
            "If you say whether an answer was right or wrong: your vote, the reason you picked, and the title and type of the analysis, without the photo or your identity.",
          ],
        },
        "The app does not collect your location or contacts and shows no ads. Your data is never sold.",
      ],
    },
    {
      heading: "Where your photos go",
      body: [
        "To be analysed, a photo is sent to an artificial intelligence service:",
        {
          list: [
            "by default, Google Gemini. On Gemini's free tier, Google may use submitted content to improve its services, and humans may review it. Avoid analysing highly sensitive documents if that concerns you;",
            "if you add your own API key, the provider you chose (Anthropic, Google, OpenAI or another) under its own terms.",
          ],
        },
        "Our server forwards the photo to the AI and then forgets it: it does not keep it.",
      ],
    },
    {
      heading: "Where your data is stored",
      body: [
        {
          list: [
            "Without an account: history and photos stay on your device only.",
            "With an account: they are also stored with Supabase (database and file storage) to sync across your devices. Each account can only access its own data.",
            "Your personal API key is encrypted (AES-256) before it is saved, and only your account can retrieve it.",
            "The website and API are hosted by Vercel; free-trial counters are stored with Upstash.",
          ],
        },
      ],
    },
    {
      heading: "How long",
      body: [
        {
          list: [
            "Your history is kept until you delete it, or delete your account.",
            "The IP address counter is erased after 30 days; the questions counter after 2 days.",
            "The host's technical logs are kept for a few days.",
          ],
        },
      ],
    },
    {
      heading: "Notifications and permissions",
      body: [
        "The camera is only used when you take a photo. Reminders are notifications scheduled on your phone; you can revoke permissions at any time in the phone's settings.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        "At any time you can:",
        {
          list: [
            "delete a scan, or your whole history, from the app;",
            "delete your account and all its data from Settings → Account → Delete my account;",
            "ask for a copy of your data or ask a question by writing to us.",
          ],
        },
      ],
    },
    {
      heading: "Minimum age",
      body: ["The app is not intended for children under 13."],
    },
    {
      heading: "Changes",
      body: ["If this policy changes, the date at the top of the page is updated and significant changes are announced in the app."],
    },
  ],
};

const termsFr: LegalDocument = {
  title: "Conditions d’utilisation",
  intro: "En utilisant Assisteo Agny, tu acceptes les conditions ci-dessous. Elles sont courtes : lis-les.",
  sections: [
    {
      heading: "Le service",
      body: [
        "Assisteo Agny analyse une photo avec une intelligence artificielle et donne des informations pratiques : identification, valeurs nutritionnelles estimées, recettes, contenu de documents, informations sur un véhicule, rappels.",
      ],
    },
    {
      heading: "Des réponses à vérifier",
      body: [
        "Les réponses sont produites automatiquement par une IA. Elles peuvent être incomplètes ou fausses.",
        {
          list: [
            "Les valeurs nutritionnelles et les prix sont des estimations.",
            "Les informations ne remplacent pas l’avis d’un médecin, d’un mécanicien, d’un juriste ou d’un conseiller financier.",
            "Les rappels (y compris ceux d’assurance) sont une aide : tu restes responsable de tes échéances. Une notification peut ne pas arriver si le téléphone est éteint ou si les notifications sont coupées.",
          ],
        },
      ],
    },
    {
      heading: "Essai gratuit et clé API personnelle",
      body: [
        "Un nombre limité de scans et de questions est offert. Ces limites peuvent changer. Au-delà, tu peux ajouter ta propre clé API : son usage est alors facturé par ton fournisseur, selon ses conditions, et tu en es responsable.",
      ],
    },
    {
      heading: "Usage acceptable",
      body: [
        "Tu t’engages à ne pas :",
        {
          list: [
            "analyser des photos de personnes sans leur accord, ni chercher à identifier quelqu’un ;",
            "envoyer des contenus illégaux ou qui ne t’appartiennent pas ;",
            "contourner les limites de l’essai, surcharger le service ou tenter d’y accéder sans autorisation.",
          ],
        },
        "En cas d’abus, l’accès peut être limité ou suspendu.",
      ],
    },
    {
      heading: "Ton compte",
      body: ["Tu es responsable de l’accès à ton adresse e-mail, qui sert à te connecter. Tu peux supprimer ton compte à tout moment depuis les réglages."],
    },
    {
      heading: "Disponibilité et responsabilité",
      body: [
        "Le service est fourni tel quel, sans garantie de disponibilité permanente. Il dépend de services tiers (IA, hébergement) qui peuvent être indisponibles. Dans les limites permises par la loi, l’éditeur n’est pas responsable des décisions prises sur la base des réponses de l’app.",
      ],
    },
    {
      heading: "Modifications",
      body: ["Ces conditions peuvent évoluer. La date en haut de la page indique la dernière version ; continuer à utiliser l’app vaut acceptation."],
    },
  ],
};

const termsEn: LegalDocument = {
  title: "Terms of use",
  intro: "By using Assisteo Agny you agree to the terms below. They are short: please read them.",
  sections: [
    {
      heading: "The service",
      body: [
        "Assisteo Agny analyses a photo with artificial intelligence and gives practical information: identification, estimated nutrition, recipes, document contents, vehicle information, reminders.",
      ],
    },
    {
      heading: "Answers to double-check",
      body: [
        "Answers are generated automatically by an AI. They can be incomplete or wrong.",
        {
          list: [
            "Nutrition values and prices are estimates.",
            "The information does not replace advice from a doctor, mechanic, lawyer or financial adviser.",
            "Reminders (including insurance ones) are an aid: you remain responsible for your deadlines. A notification may not arrive if the phone is off or notifications are disabled.",
          ],
        },
      ],
    },
    {
      heading: "Free trial and personal API key",
      body: [
        "A limited number of scans and questions is offered. These limits may change. Beyond them, you can add your own API key: its usage is then billed by your provider under its terms, and you are responsible for it.",
      ],
    },
    {
      heading: "Acceptable use",
      body: [
        "You agree not to:",
        {
          list: [
            "analyse photos of people without their consent, or try to identify anyone;",
            "submit illegal content or content that isn't yours;",
            "get around trial limits, overload the service or try to access it without permission.",
          ],
        },
        "In case of abuse, access may be limited or suspended.",
      ],
    },
    {
      heading: "Your account",
      body: ["You are responsible for access to the e-mail address you sign in with. You can delete your account at any time from the settings."],
    },
    {
      heading: "Availability and liability",
      body: [
        "The service is provided as is, without any guarantee of permanent availability. It relies on third-party services (AI, hosting) that may be unavailable. To the extent permitted by law, the publisher is not liable for decisions made based on the app's answers.",
      ],
    },
    {
      heading: "Changes",
      body: ["These terms may change. The date at the top of the page shows the latest version; continuing to use the app means you accept it."],
    },
  ],
};

export const legalDocuments: Record<LegalKind, Record<Locale, LegalDocument>> = {
  privacy: { fr: privacyFr, en: privacyEn },
  terms: { fr: termsFr, en: termsEn },
};
