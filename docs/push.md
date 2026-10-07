# Rappels en notification push (Android)

Les rappels sont d’abord des **notifications locales** : programmées sur le
téléphone, précises à la minute et sans réseau. Leur limite : un rappel créé
sur un autre appareil n’est programmé sur ce téléphone qu’une fois l’app
ouverte ici.

Les **push** comblent ce trou. Toutes les 10 minutes, le serveur envoie les
rappels arrivés à échéance aux téléphones Android du compte **qui ne les ont
pas déjà en local** : pas de doublon.

Sans la configuration ci-dessous, tout fonctionne comme avant, en local
uniquement.

## Comment ça marche

1. Connecté, l’app Android enregistre son jeton push dans `push_devices`,
   avec la liste des rappels qu’elle a déjà programmés (`services/push.ts`).
2. GitHub Actions appelle `/api/cron/reminders` toutes les 10 minutes
   (`.github/workflows/reminders.yml`).
3. Le serveur cherche les rappels échus depuis moins de 6 h, puis envoie un push
   via Firebase Cloud Messaging aux appareils qui ne les ont pas
   (`lib/server/reminderPush.ts`, `lib/server/fcm.ts`).
4. Si l’envoi échoue (panne FCM), le rappel est retenté au passage suivant.
   Les jetons d’apps désinstallées sont oubliés.

## Mise en place

### 1. Projet Firebase

1. Va sur https://console.firebase.google.com, puis **Ajouter un projet** (Analytics inutile).
2. **Ajouter une application → Android**, nom du package : `com.mahery.pocketassistant`.
3. Télécharge **`google-services.json`**.

### 2. Le fichier dans l’APK (GitHub)

Dépôt GitHub, puis **Settings → Secrets and variables → Actions → New repository secret** :

| Nom                    | Valeur                                    |
| ---------------------- | ----------------------------------------- |
| `GOOGLE_SERVICES_JSON` | tout le contenu de `google-services.json` |

Le workflow APK l’ajoute au build et active les push
(`NEXT_PUBLIC_PUSH_ENABLED=true`). Sans ce secret, l’APK est construit sans
push. Pour un build local, place le fichier dans `android/app/` : il est
ignoré par git.

### 3. Le serveur (Vercel)

1. Firebase : **Paramètres du projet → Comptes de service → Générer une nouvelle clé privée** (fichier JSON).
2. Vercel, puis **Settings → Environment Variables** (Production) :

| Nom                        | Valeur                                       |
| -------------------------- | -------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | le contenu du JSON (ou ce contenu en base64) |

3. Redéploie.

### 4. Le déclencheur (GitHub)

Toujours dans les secrets GitHub :

| Nom           | Valeur                                                        |
| ------------- | ------------------------------------------------------------- |
| `CRON_SECRET` | la même valeur que `CRON_SECRET` sur Vercel (voir `.env.local`) |

La variable `NEXT_PUBLIC_API_URL`, déjà utilisée par le build APK, sert
d’adresse. Les tâches planifiées de GitHub ne tournent que sur la branche par
défaut (`master`), et peuvent démarrer avec quelques minutes de retard.

### 5. Vérifier

1. Installe le nouvel APK, connecte-toi et autorise les notifications.
2. Sur un **autre** appareil (ou sur le web), connecté au même compte,
   programme un rappel dans 15 minutes sur un scan.
3. Ne rouvre pas l’app sur le téléphone : le push arrive à l’heure, à quelques
   minutes près.
4. Dans GitHub, onglet **Actions → Reminder pushes**, chaque passage affiche
   `{"due":…,"sent":…}`.

iOS n’est pas encore branché : il faut un Mac et une clé APNs. Les rappels
restent locaux sur iPhone.
