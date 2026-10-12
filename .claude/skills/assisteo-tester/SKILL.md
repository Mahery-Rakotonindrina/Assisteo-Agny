---
name: assisteo-tester
description: Vérifie une modification d'Assisteo Agny avant de la livrer. Couvre lint, types, tests unitaires (Vitest) et de bout en bout (Playwright, mode démo), puis un test en vrai avec l'IA réelle, des comptes jetables (gratuit, Lite, Premium, Pro) et un Edge sans écran piloté par script. À utiliser après chaque fonctionnalité ou correction, avant un commit, ou quand l'utilisateur dit « teste », « vérifie », « est-ce que ça marche ».
---

# Tester Assisteo Agny

## 1. Contrôles automatiques (toujours)

```bash
node .claude/skills/assisteo-tester/scripts/check.mjs          # les 4 : lint, types, unitaires, bout en bout
node .claude/skills/assisteo-tester/scripts/check.mjs --fast   # sans le bout en bout, pendant le travail
```

Le script affiche une ligne par étape. En cas d'échec, il n'affiche que la partie utile de la sortie et s'arrête là. Ne pas lancer les commandes brutes (`npx eslint`, `vitest`, `playwright`) : leur sortie est longue et coûte des tokens.

- Playwright construit l'app lui-même (`npm run build`), la lance sur le port 3200 avec `AI_DEMO_MODE=true` (réponses d'exemple, aucun appel IA) et utilise l'Edge installé. Ça prend environ 3 à 4 minutes. Le port 3200 doit être libre.
- `tests/unit/locales.test.ts` exige les mêmes clés et les mêmes `{placeholders}` dans `locales/fr.json` et `locales/en.json`.
- Toute nouvelle logique pure reçoit son test dans `tests/unit/` (exemple : `scanFeatures.test.ts`).
- La CI (`.github/workflows/ci.yml`) refait ces 4 contrôles. Elle teste aussi la restauration des sauvegardes sur un Postgres vide : une table oubliée dans `RESTORE_KEYS` la fait échouer (voir le skill `assisteo-nouvelle-fonction`).

## 2. Test en vrai : écran, IA réelle, offres

Les tests automatiques tournent en mode démo. Ils ne prouvent ni que l'IA réelle répond bien, ni que les offres bloquent ce qu'il faut, ni que l'écran est correct. Pour une fonction visible :

1. Si le code a changé depuis le dernier build : `npm run build`. Puis lancer en arrière-plan `npx next start -p 3130`. Ce serveur lit `.env.local` : vraie clé Gemini, **vraie base Supabase**, Redis.
2. Écrire un script dans le scratchpad à partir de [scripts/example-check.mjs](scripts/example-check.mjs), en important [scripts/live.mjs](scripts/live.mjs) par son chemin absolu.
3. Le lancer avec **Node 22** : `OUT_DIR=<scratchpad>/live "$NVM_HOME/v22.23.3/node.exe" <script>`. Le `node` par défaut ici est le 20, qui n'a pas de `WebSocket` global.
4. **Regarder les captures** (Read sur le `.png`). Un texte trouvé dans la page ne prouve pas que l'écran est bon : une fenêtre peut le recouvrir, ou il peut déborder.
5. À la fin, arrêter le serveur (TaskStop sur la tâche, ou tuer le processus qui écoute le port 3130).

### Ce que donne `live.mjs`

| Fonction | Rôle |
| --- | --- |
| `account(prefix, plan?)` | Compte jetable `…@example.com`, connecté, avec une offre d'un mois si `plan` est `"lite"`, `"premium"`, `"pro"` ou `"unlimited"`. Renvoie `{ email, id, session, auth }`. |
| `api(method, path, body, headers)` | Appel à l'API de l'app. Passer `who.auth` pour être connecté. Un `x-install-id` neuf est ajouté. |
| `adminApi(...)` | API admin avec le jeton admin. Refusée (401) si la double authentification admin est activée. |
| `browser({ mobile })` | Edge sans écran, de la taille d'un téléphone par défaut. |
| `page.go`, `text`, `click`, `realClick`, `waitFor`, `shot`, `evaluate`, `send` | Navigation, lecture du texte, clics (un vrai clic souris pour copier), attente, capture, code dans la page, appel CDP brut. |
| `page.settings()`, `page.login(who)` | Saute l'accueil ; connecte la page avec le compte. Recharger ensuite (`page.go`). |
| `page.paste(imageOfText([...]))` / `imageFromBase64` | Colle une image sur l'écran de scan, comme Ctrl+V. **Lance une vraie analyse.** |
| `page.offline(true/false)` | Coupe ou rétablit le réseau. |
| `check(label, ok, extra)` | Affiche PASS/FAIL. |
| `cleanup()` | Supprime comptes, abonnements et profils Edge. Renvoie le nombre d'échecs. Toujours l'appeler dans un `finally`. |

## Pièges connus

- Les comptes sont créés dans la **vraie base**. Toujours appeler `cleanup()` dans un `finally`, même si le script plante.
- Chaque profil Edge pèse environ 50 Mo. Ils ont déjà rempli le disque, au point que plus aucune commande ne passait. `cleanup()` et `page.close()` les suppriment. Après beaucoup de lancements, vérifier l'espace libre (`Get-PSDrive C`).
- Un compte payant neuf voit d'abord « Bienvenue dans <offre> ». Il faut cliquer « C’est parti », avec l'apostrophe typographique.
- Une analyse réelle consomme un scan du compte et coûte un appel IA : n'en lancer que le nécessaire. Prévoir `waitFor` jusqu'à 60 s.
- Données locales de la page : IndexedDB `pocket-assistant` (historique, store `history`) et `pocket-assistant-queue` (file hors ligne, store `scans`). Les lire avec `page.evaluate`.
- **Impossible à tester ici** : l'app Android native (partage depuis WhatsApp, caméra native, notifications push) et l'iPhone. Le dire à l'utilisateur et lui donner quoi tester sur son téléphone une fois l'APK construit.
