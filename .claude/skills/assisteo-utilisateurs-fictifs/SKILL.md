---
name: assisteo-utilisateurs-fictifs
description: Fait jouer à des utilisateurs fictifs d'Assisteo Agny (visiteuse venue de Google en 3G, étudiant au forfait serré, retraitée en très grand texte, maman Premium, revendeur Pro, expatrié en anglais, comptable sur ordinateur, technicien hors ligne) leurs parcours dans l'app, puis rend un rapport par profil et par écran, avec captures et planches. À utiliser quand l'utilisateur demande un « testeur fictif », des « utilisateurs fictifs », un « rapport de test de plusieurs écrans » ou « plusieurs types d'utilisateurs », un « tour complet de l'app », ou avant une grosse mise en ligne.
---

# Utilisateurs fictifs d'Assisteo Agny

Chaque profil a une offre (sans compte, gratuit, Lite, Premium, Pro), un appareil (téléphone ou ordinateur), une langue, un thème, une taille de texte et un réseau (bon, 3G, coupures). Le script joue ses étapes dans un Edge sans écran. À chaque étape, il vérifie :

| Contrôle | Gravité |
| --- | --- |
| Texte attendu absent, ou encore présent alors qu'il devrait avoir disparu (`expect` / `expectNot`) ; bouton introuvable ; scan sans résultat ; erreur JavaScript | ❌ |
| Débordement sur le côté, clé de traduction brute (`discover.faq…`), mots de l'autre langue, mauvaise langue de la page, erreur dans la console, réponse 5xx ou fichier 404, image cassée, bouton sans nom pour les lecteurs d'écran, page lente (> 5 s, > 15 s en 3G) | ⚠️ |
| Réponses 4xx de l'API, requêtes bloquées hors ligne | note |

Ce qui ne se voit qu'à l'œil (mise en page laide, texte coupé, contraste) se juge sur les **planches** : une image par profil, avec toutes ses captures numérotées et encadrées de vert, d'orange ou de rouge.

## Lancer

1. **Construire** l'app si le code a changé : `npm run build`. Personne d'autre ne doit construire en même temps, sinon les deux builds se marchent dessus dans `.next`, qu'il s'agisse de `check.mjs` ou d'un autre agent.
2. **Jouer les profils** en arrière-plan (comptez environ 1 minute par profil, plus en 3G) :

```bash
"$NVM_HOME/v22.23.3/node.exe" .claude/skills/assisteo-utilisateurs-fictifs/scripts/run.mjs --serve
```

- `--serve` démarre l'app construite sur le port 3140 avec l'**IA en mode démo** : les scans sont gratuits. Le serveur est arrêté à la fin, processus `next start` compris.
- `--only voahangy,hery` : seulement ces profils.
- Sans `--serve`, avec `BASE_URL=https://assisteo-agny.vercel.app` : teste le **site en ligne**. Les scans sont alors sautés, sauf avec `--real-ai`, et chacun coûte alors un appel IA et un scan.
- **Node 22** obligatoire : le `node` par défaut est le 20, qui n'a pas de `WebSocket` global.

3. **Lire** seulement ce qu'il faut :
   - la console : une ligne par profil, puis le chemin du rapport ;
   - le `rapport.md` du dossier indiqué : un tableau par profil, avec une ligne par étape ;
   - les planches (`planche-<profil>.jpg`), avec Read. Ouvrir une capture seule (`captures/<profil>-<n>.jpg`) seulement pour une étape ⚠️ ou ❌ à comprendre.

## Rapport au propriétaire

En français, sans jargon :
1. Un tableau : profil, offre et appareil, résultat (✅ / ⚠️ / ❌).
2. Les problèmes, du plus grave au moins grave : qui, sur quel écran, ce qu'on voit, et l'étape pour le reproduire.
3. Ce qu'on a remarqué sur les planches (mise en page, lisibilité).
4. Ce qui n'a pas pu être testé : l'app Android native (caméra, partage, notifications) et l'iPhone.

Ne pas recopier le rapport brut. Pour un bug à corriger, passer par le développeur, comme le prévoit CLAUDE.md.

## Ajouter un profil ou un écran

Tout est dans [scripts/personas.mjs](scripts/personas.mjs) :
- un nouvel écran va dans `SCREENS` (par exemple `/garage`) : les profils `tour: true` le visitent ;
- une étape fait une chose : `go`, `click` (texte visible d'un bouton, d'un lien, d'un onglet ou d'une question de FAQ), `scan: "document"`, `offline`, `wait`. On peut y ajouter `expect` / `expectNot` ;
- utiliser les textes exacts de `locales/fr.json`, avec les apostrophes typographiques (’) quand le texte en a.

## Pièges

- Les comptes sont créés dans la **vraie base** Supabase et supprimés à la fin par `cleanup()` (`assisteo-tester/scripts/live.mjs`). Après un plantage, vérifier qu'il ne reste pas de comptes `fictif-…@example.com`.
- L'essai gratuit est limité par adresse IP. Après beaucoup de lancements, les scans des profils sans compte peuvent répondre « essai épuisé » : c'est une limite de test, pas un bug de l'app.
- Un compte payant neuf voit d'abord « Bienvenue dans <offre> ». Le script le ferme seul.
- Chaque Edge pèse environ 50 Mo de profil. Le script les supprime, mais il faut surveiller l'espace disque après beaucoup de lancements.
