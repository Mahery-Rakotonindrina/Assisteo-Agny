# Assisteo Agny

Petite app mobile : tu prends en photo un aliment, un document ou un objet, l'IA (Claude) l'analyse et te renvoie des infos utiles et des suggestions. Les analyses sont gardées dans un historique local et peuvent déclencher des rappels par notification.

**Caméra → IA → réponse → historique local → notifications**

| Domaine | Ce que le projet montre |
| --- | --- |
| React / Next.js 16 | Pages Router, export statique pour le mobile, API Routes pour le serveur |
| TypeScript | Typage strict de bout en bout, schéma Zod partagé client/serveur |
| IA | Claude (vision) avec sorties structurées validées par Zod |
| API | `/api/analyze`, `/api/health`, CORS Capacitor, rate limiting, erreurs typées |
| Mobile | Capacitor 8 : caméra, galerie, notifications locales, haptique, partage, status bar, bouton retour Android |
| Stockage local | IndexedDB (`idb-keyval`) pour l'historique + images, Preferences pour les réglages |
| UX / animations | Motion (transitions, layout animations, swipe-to-delete, compteurs, anneaux SVG), thème clair/sombre, FR/EN, `prefers-reduced-motion` respecté |

## Démarrage rapide

```bash
npm install
cp .env.example .env.local   # optionnel : ajoute ANTHROPIC_API_KEY
npm run dev
```

Ouvre http://localhost:3000. Le moteur IA est choisi selon les clés présentes dans `.env.local` (voir [Moteurs IA](#moteurs-ia)) :

| Clé configurée | Moteur | Coût |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude (prioritaire) | Payant (crédit Anthropic) |
| `GEMINI_API_KEY` | Gemini | **Gratuit** (clé sur [aistudio.google.com](https://aistudio.google.com)) |
| aucune | Mode démo | Gratuit, réponses d'exemple (l'IA ne regarde pas la photo) |

Le moteur actif est visible dans la barre latérale (ordinateur) et dans Réglages → Moteur IA. Un bandeau prévient quand l'app est en mode démo.

### Deux interfaces

- **Mobile** (apps Android/iOS et navigateur de téléphone) : une colonne, barre d'onglets, gros bouton caméra, suppression par glissement.
- **Ordinateur** (navigateur ≥ 1024 px) : barre latérale avec statut IA et installation PWA, zone de glisser-déposer, collage d'image avec **Ctrl+V**, webcam, résultat sur deux colonnes avec image fixe, historique en grille, réglages sur deux colonnes.

Les apps natives gardent toujours l'interface mobile, même sur tablette : une classe `native` est posée sur `<html>` avant le premier affichage. Les styles bureau passent par le mixin SCSS `desktop` (`styles/_mixins.scss`) et le hook `useIsDesktop`.

## Architecture

```
pages/
  index.tsx          Scanner : choix du mode, capture, animation d'analyse
  result.tsx         Résultat : ?id=<entrée d'historique>
  history.tsx        Historique : recherche, filtres, groupes par jour, swipe pour supprimer
  settings.tsx       Langue, thème, notifications, haptique, données, statut IA
  api/analyze.ts     POST image → analyse (Claude, Gemini ou démo)
  api/health.ts      GET statut du moteur IA
lib/ai/              schema.ts (contrat Zod partagé), provider.ts, claude.ts, gemini.ts, prompt.ts, mock.ts
lib/server/          CORS + rate limiting
lib/image.ts         Redimensionnement / ré-encodage JPEG (supprime l'EXIF)
services/            camera, notifications, device (haptique/partage), historyStore, analysisService
hooks/useScan.ts     Machine d'état capture → préparation → analyse → sauvegarde
components/          UI (CaptureOrb, ScanStage, Result/*, HistoryItem, TabBar…)
```

**Un seul code, deux cibles de build :**

- `npm run build` → serveur Next.js classique (pages + API Routes). C'est lui qu'on déploie (Vercel, etc.).
- `npm run build:mobile` → export statique dans `out/`, embarqué dans l'app Capacitor. Les API Routes ne sont pas exportées : l'app appelle le serveur déployé via `NEXT_PUBLIC_API_URL`.

C'est pour ça que la langue est gérée côté client (réglages persistés) et non par l'i18n de Next, qui est incompatible avec l'export statique.

### Flux d'une analyse

1. `services/camera.ts` ouvre la caméra native ou la galerie (`Camera.takePhoto` / `chooseFromGallery`).
2. `lib/image.ts` produit 3 tailles : 1568 px pour l'IA, 960 px pour l'écran résultat, 320 px pour la liste.
3. `POST /api/analyze` valide la requête (Zod), applique le rate limit puis appelle Claude avec l'image et un schéma de sortie structurée.
4. Le résultat est enregistré dans IndexedDB, puis l'app ouvre l'écran résultat. Si l'app est en arrière-plan, une notification locale prévient que c'est prêt.
5. Si l'IA propose un rappel (date limite, aliment à finir, plante à arroser…), « Me le rappeler » programme une notification locale.

### Moteurs IA

Les deux moteurs partagent le même prompt et le même schéma Zod (`lib/ai/schema.ts`). Le reste de l'app ne sait pas lequel a répondu. `lib/ai/provider.ts` choisit le moteur ; `AI_PROVIDER=claude|gemini` permet de forcer le choix.

**Gemini (gratuit)** — `lib/ai/gemini.ts`
- `gemini-flash-latest`, avec repli automatique sur `gemini-flash-lite-latest` quand le premier est saturé ou que son quota gratuit est atteint (503/429). Une analyse prend 2 à 3 s.
- Sortie JSON contrainte par `responseJsonSchema` (généré depuis le schéma Zod), puis revalidée avec Zod.
- Sur l'offre gratuite, Google peut utiliser les contenus envoyés pour améliorer ses modèles, et les quotas sont limités par minute et par jour.

**Claude (payant, meilleure qualité)** — `lib/ai/claude.ts`
- Modèle par défaut : `claude-opus-5-5` (modifiable via `ANTHROPIC_MODEL`), effort `medium` (`AI_EFFORT`).
- Sortie structurée : `client.beta.messages.parse` + `betaZodOutputFormat(AnalysisSchema)`, donc la réponse est validée et typée.
- Le fallback serveur (`fallbacks: "default"`) est activé : si le modèle refuse une image, l'API relance automatiquement la requête sur le modèle de repli recommandé.
- Le prompt système est mis en cache (`cache_control`).
- Si l'utilisateur annule ou quitte l'écran, la requête est interrompue (Claude comme Gemini).
- Compte sans crédit : l'app affiche « Le compte IA n'a plus de crédit » au lieu d'une erreur générique.

## Tester sur téléphone

Les projets natifs `android/` et `ios/` sont déjà générés et configurés (autorisations caméra/photos iOS, orientation portrait).

### Étape 1 : déployer la version web (indispensable)

Elle héberge l'API IA. Les applications natives et la version iPhone l'appellent.

1. Pousse le projet sur GitHub.
2. Sur [vercel.com](https://vercel.com) : *Add New → Project*, puis importe le dépôt et déploie. Ajoute `ANTHROPIC_API_KEY` dans *Environment Variables* pour la vraie IA ; sans clé, le mode démo est actif.
3. Note l'URL obtenue, par exemple `https://assisteo-agny.vercel.app`.

### Android : APK compilé dans le cloud

Aucun SDK n'est nécessaire en local : le workflow [.github/workflows/android-apk.yml](.github/workflows/android-apk.yml) compile un APK de debug.

1. Sur GitHub : *Settings → Secrets and variables → Actions → Variables*, puis crée `NEXT_PUBLIC_API_URL` avec l'URL Vercel.
2. *Actions → Android APK → Run workflow*. Compte environ 5 minutes.
3. Télécharge l'artefact `assisteo-agny-android`, envoie l'APK sur le téléphone et ouvre-le (autorise l'installation depuis cette source).

En local, si tu as Android Studio et environ 10 Go libres : `nvm use 22`, puis `npm run cap:android`, puis ▶ Run.

### iPhone

**Sans Mac (tout de suite)** : ouvre l'URL Vercel dans Safari, puis *Partager → Sur l'écran d'accueil*. L'app s'ouvre en plein écran. La caméra, la galerie, l'IA, l'historique, le partage et les réglages fonctionnent. Ne fonctionnent pas en version web sur iOS : les notifications locales et les vibrations.

**App native (demande un Mac avec Xcode, exigence d'Apple)** :

```bash
nvm use 22 && npm ci
echo "NEXT_PUBLIC_API_URL=https://ton-app.vercel.app" > .env.local
npm run cap:ios          # build + sync + ouvre Xcode
```

Ensuite, dans Xcode :

1. Ouvre *App → Signing & Capabilities*, choisis ta *Team* (ton Apple ID gratuit suffit) et rends l'identifiant de bundle unique si besoin.
2. Branche l'iPhone et active *Réglages → Confidentialité et sécurité → Mode développeur*.
3. Lance ▶ Run. Au premier lancement, va sur l'iPhone dans *Réglages → Général → VPN et gestion de l'appareil* et fais confiance au certificat.

Avec un Apple ID gratuit, l'app expire au bout de 7 jours. Pour la garder ou la distribuer via TestFlight, il faut le programme Apple Developer (99 $/an). La compilation peut alors se faire sur un Mac dans le cloud (Codemagic, GitHub Actions macOS), sans posséder de Mac.

### Notes

- Le CLI Capacitor 8 demande **Node ≥ 22** (voir `.nvmrc`) : lance `nvm use 22` avant les scripts `cap:*`.
- **Live reload sur un appareil** : lance `npm run dev:lan`, puis `CAP_SERVER_URL=http://<ip-du-pc>:3000 npx cap sync`. Il faut que le téléphone puisse joindre le PC (même réseau, pare-feu ouvert).
- **Android** : aucune permission à ajouter. Le plugin de notifications déclare les siennes, et la caméra n'en demande aucune tant que `saveToGallery` vaut `false`.

Les origines Capacitor (`capacitor://localhost`, `https://localhost`) sont autorisées en CORS par l'API. Pour d'autres front-ends, utilise `ALLOWED_ORIGINS`.

## Scripts

| Script | Rôle |
| --- | --- |
| `npm run dev` / `dev:lan` | Serveur de dev (local / réseau local) |
| `npm run build` / `start` | Build et serveur web de production |
| `npm run build:mobile` | Export statique pour Capacitor (`out/`) |
| `npm run cap:android` / `cap:ios` | Build mobile + `cap sync` + ouverture de l'IDE natif |
| `npm run lint` / `typecheck` | ESLint / TypeScript |

## E-mails de connexion

Le modèle d’e-mail (code à 6 chiffres) est dans [`supabase/templates/sign-in-code.html`](supabase/templates/sign-in-code.html). Pour envoyer depuis ton propre domaine avec Resend au lieu de Gmail : [docs/emails.md](docs/emails.md).

## Confidentialité

Les photos sont ré-encodées côté client (métadonnées EXIF supprimées), envoyées uniquement pour l'analyse, et ne sont pas stockées par le serveur. L'historique et les réglages restent sur l'appareil.

## Pistes d'évolution

- Questions de suivi sur une photo (conversation multi-tours).
- Rate limiting partagé (Upstash / Redis) pour un déploiement multi-instances.
- Export / synchronisation de l'historique.
- Tests (Vitest pour `lib/`, Playwright pour le parcours de scan).
