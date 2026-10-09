---
name: assisteo-livrer
description: Livre une modification d'Assisteo Agny. Couvre la case de TODO.md, le commit au format du projet, le push sur develop et le suivi de la CI GitHub. Sur demande seulement, passe develop en production via master, ce qui déploie le site et construit l'APK Android. À utiliser quand l'utilisateur dit « commit », « pousse », « livre », « mets en ligne », « fusionne », « passe en prod » ou « nouvelle version de l'APK ».
---

# Livrer Assisteo Agny

Dépôt : `Mahery-Rakotonindrina/Assisteo-Agny` (GitHub, public). Le CLI `gh` est installé dans `%LOCALAPPDATA%\Programs\gh\bin`. Il ne sert qu'une fois que l'utilisateur a fait `gh auth login` (vérifier avec `gh auth status`). Sans connexion, passer par `git` et les scripts ci-dessous.

## Branches

- On travaille sur `develop`.
- `master` est la production. Chaque push sur `master` déploie le site sur Vercel et lance le workflow `Android APK`.
- Les mises en production passent par une Pull Request `develop → master` sur GitHub (#16 à #19).

## 1. Commit (seulement si l'utilisateur l'a demandé)

1. Le skill `assisteo-tester` est passé au vert.
2. `TODO.md` est à jour (cases cochées, avec une précision courte).
3. `git add -A`, puis `git status --short` : rien qui ne doive pas partir (pas de `.env*`, pas de fichiers de test). Les avertissements « LF will be replaced by CRLF » sont normaux. Le bloc d'AGENTS.md réécrit par `next dev` se committe avec le reste.
4. Le message est en anglais, au format `type(scope): what it does`. Types : `feat`, `fix`, `build`, `docs`. Exemples : `feat(scan): multi-page (Premium), share to the app, QR codes…`, `fix(admin): keep the chart legend readable at half width`. Le corps liste ce qui change pour l'utilisateur, en lignes d'environ 72 caractères, et se termine par la ligne d'attribution demandée par le système.

## 2. Push sur develop et suivi de la CI

```bash
git fetch -q origin && git push -q origin develop
node .claude/skills/assisteo-livrer/scripts/ci-wait.mjs        # attend la CI du dernier commit
```

- Le script attend la fin et affiche une ligne par workflow. En cas d'échec, il affiche aussi le job et l'étape fautifs. Il prend un commit en argument (par défaut `HEAD`).
- La CI dure quelques minutes. Un push qui ne change que des `.md` ne la lance pas (`paths-ignore`).
- Pour les journaux d'un échec : `gh run view <id> --repo Mahery-Rakotonindrina/Assisteo-Agny --log-failed` (seulement les lignes en échec), si `gh` est connecté. Sinon, reproduire l'échec en local.

## 3. Mise en production (uniquement sur demande explicite)

Avant :

- **Nouvelle migration SQL ?** Elle doit être appliquée à la base de production avant le déploiement, avec l'accord de l'utilisateur (voir `assisteo-nouvelle-fonction`). Sinon l'API plante sur une table absente.
- Demander comment fusionner :
  - **Pull Request** (comme d'habitude) : avec `gh` connecté, `gh pr create --base master --head develop --title "…" --body "…"`. Sinon, donner le lien `https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/compare/master...develop`. Dans les deux cas, l'utilisateur fusionne la PR ;
  - **fusion locale** : `git checkout master && git pull -q && git merge --no-ff develop && git push origin master && git checkout develop`.

Ce qui se passe ensuite (`.github/workflows/android-apk.yml`) :

- Le site se met à jour sur Vercel. L'API change pour tout le monde, l'APK y compris.
- L'APK est construit dans le cloud, en version `1.0.<numéro du run>`. Le workflow refuse de le construire si `NEXT_PUBLIC_API_URL/api/health` ne répond pas 200.
- L'APK signé est publié en release `v1.0.N`. Lien fixe : `https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/releases/latest/download/AssisteoAgny.apk`.
- Si le secret `ADMIN_TOKEN` existe (plus `CRON_SECRET` quand la double authentification admin est active), le workflow annonce lui-même la dernière version dans Admin → « Versions de l'app ». Sinon, l'utilisateur la saisit à la main. La **version minimale** (forcer la mise à jour) reste toujours manuelle : la proposer quand un changement natif ou d'API l'exige.
- L'app Android embarque ses écrans : un changement d'interface n'atteint les téléphones Android qu'avec le nouvel APK. Un nouveau plugin Capacitor ou une modification d'`AndroidManifest.xml` l'exige aussi.

## 4. Message de fin à l'utilisateur (en français, sans jargon)

- Ce qui est en ligne, et ce que la CI a vérifié.
- Ce qu'il doit faire lui-même : fusionner la PR, régler les versions dans l'Admin, tester sur son téléphone (liste précise), surveiller le coût IA si la fonction appelle l'IA plus souvent.
- Ce qui n'a pas pu être testé ici : l'Android natif et l'iPhone.
