---
name: assisteo-livrer
description: Livre une modification d'Assisteo Agny. Couvre la case de TODO.md, le commit au format du projet, la branche de fonctionnalité et sa Pull Request vers develop, et le suivi de la CI GitHub. Jamais vers master : seul l'utilisateur fusionne develop dans master (mise en ligne du site et de l'APK Android). À utiliser quand l'utilisateur dit « commit », « pousse », « livre », « mets en ligne », « fusionne », « passe en prod » ou « nouvelle version de l'APK ».
---

# Livrer Assisteo Agny

Dépôt : `Mahery-Rakotonindrina/Assisteo-Agny` (GitHub, public). Le CLI `gh` est installé dans `%LOCALAPPDATA%\Programs\gh\bin`. Il ne sert qu'une fois que l'utilisateur a fait `gh auth login` (vérifier avec `gh auth status`). Sans connexion, passer par `git` et les scripts ci-dessous.

## Branches (règle de l'utilisateur, 2026-10-12)

- **Une branche par fonctionnalité**, partie de `develop` : `feat/<nom>`, `fix/<nom>` ou `chore/<nom>`. Elle revient dans `develop` **toujours par une Pull Request**, jamais vers `master`.
- **Seule `develop` va dans `master`**, et **seul l'utilisateur** la fusionne. Claude ne pousse jamais sur `master`, ne fusionne rien dedans, n'ouvre pas de PR vers `master` et ne passe pas sur `master` en local : `.claude/settings.local.json` bloque ces commandes.
- Le workflow `Branches` (`.github/workflows/branches.yml`) fait échouer toute PR vers `master` qui ne vient pas de `develop`.
- `master` est la production. Chaque push sur `master` déploie le site sur Vercel et lance le workflow `Android APK`.

## 1. Commit (seulement si l'utilisateur l'a demandé)

1. Le skill `assisteo-tester` est passé au vert.
2. `TODO.md` est à jour (cases cochées, avec une précision courte).
3. `git add -A`, puis `git status --short` : rien qui ne doive pas partir (pas de `.env*`, pas de fichiers de test). Les avertissements « LF will be replaced by CRLF » sont normaux. Le bloc d'AGENTS.md réécrit par `next dev` se committe avec le reste.
4. Le message est en anglais, au format `type(scope): what it does`. Types : `feat`, `fix`, `build`, `docs`. Exemples : `feat(scan): multi-page (Premium), share to the app, QR codes…`, `fix(admin): keep the chart legend readable at half width`. Le corps liste ce qui change pour l'utilisateur, en lignes d'environ 72 caractères, et se termine par la ligne d'attribution demandée par le système.

## 2. Branche, Pull Request vers develop, suivi de la CI

```bash
git fetch -q origin && git switch -c feat/<nom> origin/develop   # avant le premier commit
git push -q -u origin feat/<nom>
node .claude/skills/assisteo-livrer/scripts/ci-wait.mjs          # attend la CI du dernier commit
```

- Un commit par fonctionnalité (une case de TODO.md). Plusieurs fonctionnalités liées peuvent partager une branche et une PR.
- La PR vise **toujours `develop`** : avec `gh` connecté, `gh pr create --base develop --head feat/<nom> --title "…" --body "…"` (le dépôt a `master` comme branche par défaut : ne jamais omettre `--base develop`). Sans `gh`, donner le lien `https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/compare/develop...feat/<nom>?expand=1`.
- Fusionner la PR dans `develop` seulement si l'utilisateur le demande (`gh pr merge` demande toujours sa confirmation). Ne jamais pousser directement sur `develop`.

- Le script attend la fin et affiche une ligne par workflow. En cas d'échec, il affiche aussi le job et l'étape fautifs. Il prend un commit en argument (par défaut `HEAD`).
- La CI dure quelques minutes. Un push qui ne change que des `.md` ne la lance pas (`paths-ignore`).
- Pour les journaux d'un échec : `gh run view <id> --repo Mahery-Rakotonindrina/Assisteo-Agny --log-failed` (seulement les lignes en échec), si `gh` est connecté. Sinon, reproduire l'échec en local.

## 3. Mise en production : l'utilisateur seul

Claude ne crée pas la PR `develop → master` et ne la fusionne pas. Quand l'utilisateur veut passer en production, lui donner :

- le lien `https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/compare/master...develop?expand=1` (il ouvre et fusionne la PR lui-même) ;
- ce qu'il y a dedans (`git log --oneline origin/master..origin/develop`) et l'état de la CI de `develop` ;
- **une nouvelle migration SQL ?** Elle doit être appliquée à la base de production avant la fusion, avec son accord (voir `assisteo-nouvelle-fonction`). Sinon l'API plante sur une table absente.

Ce qui se passe ensuite (`.github/workflows/android-apk.yml`) :

- Le site se met à jour sur Vercel. L'API change pour tout le monde, l'APK y compris.
- L'APK est construit dans le cloud, en version `1.0.<numéro du run>`. Le workflow refuse de le construire si `NEXT_PUBLIC_API_URL/api/health` ne répond pas 200.
- L'APK signé est publié en release `v1.0.N`. Lien fixe : `https://github.com/Mahery-Rakotonindrina/Assisteo-Agny/releases/latest/download/AssisteoAgny.apk`.
- Si le secret `ADMIN_TOKEN` existe (plus `CRON_SECRET` quand la double authentification admin est active), le workflow annonce lui-même la dernière version dans Admin → « Versions de l'app ». Sinon, l'utilisateur la saisit à la main. La **version minimale** (forcer la mise à jour) reste toujours manuelle : la proposer quand un changement natif ou d'API l'exige.
- L'app Android embarque ses écrans : un changement d'interface n'atteint les téléphones Android qu'avec le nouvel APK. Un nouveau plugin Capacitor ou une modification d'`AndroidManifest.xml` l'exige aussi.

## 4. Message de fin à l'utilisateur (en français, sans jargon)

- Ce qui est en ligne, et ce que la CI a vérifié.
- Ce qu'il doit faire lui-même : fusionner la PR vers `develop` (si ce n'est pas fait), puis `develop → master` quand il veut mettre en ligne, régler les versions dans l'Admin, tester sur son téléphone (liste précise), surveiller le coût IA si la fonction appelle l'IA plus souvent.
- Ce qui n'a pas pu être testé ici : l'Android natif et l'iPhone.
