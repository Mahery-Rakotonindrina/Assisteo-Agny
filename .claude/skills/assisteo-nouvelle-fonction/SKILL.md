---
name: assisteo-nouvelle-fonction
description: Conventions d'Assisteo Agny pour ajouter ou modifier une fonctionnalité. Couvre pages et composants Next.js, textes FR/EN, fonctions réservées à une offre (Lite, Premium, Pro), appels IA (Gemini, Claude, clé perso), tables Supabase, stockage local et synchro, et TODO.md. À lire avant d'écrire le code d'une nouvelle fonction ou d'une case de TODO.md.
---

# Ajouter une fonction à Assisteo Agny

L'app aide les gens à Madagascar à comprendre ce qu'ils photographient (documents, aliments, colis, objets…). L'utilisateur est le propriétaire du produit, pas un développeur : il parle français et décrit des besoins, pas du code.

## Avant de coder

- **Next.js 16 avec le Pages Router** (`pages/`), pas l'App Router. Comme le dit AGENTS.md, lire le guide concerné dans `node_modules/next/dist/docs/` avant d'utiliser une API Next.
- **Un seul code, deux cibles.** `npm run build` produit le serveur déployé sur Vercel (pages + `pages/api/*`). `npm run build:mobile` produit un export statique dans `out/`, embarqué dans l'APK Android (Capacitor). Conséquences :
  - pas de `getServerSideProps` ni `getStaticProps` : les pages lisent leurs données côté client, via `/api/*` ;
  - la langue est gérée côté client, pas par l'i18n de Next ;
  - un changement d'écran n'arrive dans l'app Android qu'avec un nouvel APK, alors qu'un changement d'API touche tout le monde dès le déploiement.
- Copier le style du code voisin : densité des commentaires (en anglais), noms, idiomes. Les fichiers récents (`services/scanQueue.ts`, `components/PagesTray/`) sont de bons modèles.

## Où mettre quoi

| Quoi | Où |
| --- | --- |
| Écran | `pages/<nom>.tsx` |
| Composant | `components/Nom/Nom.tsx` + `Nom.module.scss` + `index.ts`. Styles ordinateur via le mixin `desktop` (`styles/_mixins.scss`) et `useIsDesktop`. L'app native garde toujours l'interface mobile. |
| Logique côté appareil | `services/*.ts` (caméra, historique, file hors ligne, synchro…), et les hooks dans `hooks/`. |
| API | `pages/api/*.ts`. Erreurs avec `sendError(res, status, code, message)` (`lib/server/http.ts`) ; rate limit, offre et Redis dans `lib/server/`. |
| Textes | Jamais en dur : `locales/fr.json` (référence, **tutoiement**, ton simple) et `locales/en.json`, avec les mêmes clés et les mêmes `{placeholders}` (un test le vérifie). Langues dans `i18n.config.ts` ; le malgache est prévu. |
| Montants | En ariary (`Ar`). Le paiement se fait en Mobile Money (MVola…). |

## Réserver une fonction à une offre

Ordre des offres : `free < lite < premium < pro < unlimited` (`unlimited` = administrateurs).

1. `lib/plans.ts` : ajouter un `PlanFeature`, avec son offre minimale dans `featureFrom`.
2. **Serveur** : refuser avec `sendError(res, 403, "plan_required", …)` (modèle : `pages/api/analyze.ts`). Masquer le bouton ne suffit jamais.
3. **Interface** : la fonction reste visible avec l'étiquette de l'offre et mène à `/plans` (`PlanLock`, `PlanBadge`, `planFor(feature)`, `usePlan()`). Exemple : le bouton « Plusieurs pages » + « Premium ».
4. Ajouter la ligne dans `lib/planPerks.ts`. C'est la liste montrée dans « Bienvenue dans … » et sur les offres.
5. Les quotas (scans par mois, questions par jour, analyses approfondies) et les prix se règlent depuis l'Admin (`lib/server/planConfig.ts`). Décider à quel quota la nouvelle fonction est comptée.

## IA

- `lib/ai/provider.ts` choisit le moteur selon les clés présentes : `claude.ts` si `ANTHROPIC_API_KEY` existe, sinon `gemini.ts` (le moteur utilisé aujourd'hui ; modèles flash, avec repli quand le premier est saturé). `openaiCompatible.ts` sert à la clé IA personnelle de l'utilisateur. `mock.ts` est le mode démo des tests de bout en bout : un nouveau champ de réponse a aussi besoin de sa version démo.
- `lib/ai/prompt.ts` contient le prompt commun. `lib/ai/schema.ts` contient le contrat Zod partagé par l'app et le serveur (réponses, requêtes, `x-install-id`).
- Le coût de chaque appel est suivi (`lib/server/aiPrices.ts`, Admin → coûts). Plusieurs images, ou un modèle plus puissant, coûtent plus cher : le signaler à l'utilisateur.
- Charger le skill `gemini-api-dev` avant de toucher au SDK Gemini, et `claude-api` pour Claude.

## Données

- **D'abord en local** : IndexedDB (`services/historyStore.ts`, listes, colis), réglages via Capacitor Preferences (`lib/settings/SettingsProvider.tsx`). Avec un compte, la synchro avec Supabase suit (`services/sync.ts`, `rowSync.ts`) : le plus récent gagne, et les suppressions passent par `deleted_at`.
- **Nouvelle table** :
  1. Ajouter `supabase/migrations/000N_nom.sql` avec le numéro suivant, idempotent (`if not exists`), avec RLS (chacun ne voit que ses lignes).
  2. Ajouter sa clé dans `RESTORE_KEYS` (`scripts/lib/backup.mjs`), sinon la CI échoue.
  3. Pour la production : `npm run db:migrate` avec `POSTGRES_URL_NON_POOLING` (intégration Supabase de Vercel). C'est la base de production : **demander l'accord de l'utilisateur avant**.
- Charger le skill `supabase` pour tout travail sur Supabase. Côté natif, utiliser les skills `capacitor-*`.

## Pour finir

1. Cocher la case dans `TODO.md`, avec une précision courte sur ce qui est fait (exemple : « — à partir de Premium »).
2. Skill `assisteo-tester`, puis `assisteo-livrer`.
3. Expliquer à l'utilisateur, en français et sans jargon, ce qui change pour les gens et ce qui lui reste à faire.
