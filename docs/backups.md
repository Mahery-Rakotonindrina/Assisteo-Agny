# Sauvegardes de la base de données

L’offre gratuite de Supabase ne propose pas de sauvegardes téléchargeables.
Une fois par semaine (dimanche, 3 h UTC), GitHub Actions exporte les données
des comptes, les chiffre et garde le fichier 90 jours. Juste après, il **teste
la restauration** : le fichier est restauré dans une base Postgres vide et
jetable, et chaque ligne doit revenir identique. Si la sauvegarde ou ce test
échoue, un ticket GitHub « 🔴 Sauvegarde de la base en échec » te mentionne
(tu reçois un e-mail).

## Ce qui est sauvegardé

- L’historique des analyses (avec les conversations et les rappels).
- Les réglages et les clés IA personnelles (déjà chiffrées par le serveur).
- Les colis (« Mes colis ») et les listes (« Mes listes »).
- Les abonnements enregistrés dans l’admin.
- Les appareils inscrits aux push, et la liste des comptes (id, e-mail, dates).

Les **photos ne sont pas dans la sauvegarde** : elles restent dans Supabase
Storage et sur les téléphones.

Le fichier (`assisteo-backup-AAAA-MM-JJ.agny`) est compressé puis chiffré en
AES-256-GCM avec une clé dérivée de ta phrase secrète. Sans elle, il est
illisible. Avec elle, il contient des données personnelles : garde-la en
lieu sûr (gestionnaire de mots de passe).

## Mise en place (une fois)

GitHub → **Settings → Secrets and variables → Actions → New repository secret** :

| Nom                        | Valeur                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| `POSTGRES_URL_NON_POOLING` | Supabase → **Connect → Session pooler** (ou la variable du même nom sur Vercel) |
| `BACKUP_PASSPHRASE`        | une longue phrase secrète (16 caractères minimum) que tu notes ailleurs  |

Pour tester tout de suite : onglet **Actions → Database backup → Run workflow**.
Le fichier apparaît en bas du résumé du run, dans **Artifacts**.

## Ouvrir ou restaurer une sauvegarde

Télécharge l’artifact (un .zip qui contient le .agny), puis sur ton PC :

```bash
# Voir ce qu’il contient
BACKUP_PASSPHRASE="…" npm run db:restore -- assisteo-backup-2026-10-12.agny

# Essai à blanc sur la base : tout est réécrit puis annulé
BACKUP_PASSPHRASE="…" POSTGRES_URL_NON_POOLING="…" npm run db:restore -- fichier.agny --apply --dry-run

# Restauration réelle (les comptes doivent exister, avec les mêmes id)
BACKUP_PASSPHRASE="…" POSTGRES_URL_NON_POOLING="…" npm run db:restore -- fichier.agny --apply

# Export en JSON lisible (données personnelles : supprime-le après usage)
BACKUP_PASSPHRASE="…" npm run db:restore -- fichier.agny --json sauvegarde.json
```

## Le test de restauration

Le même test tourne à chaque envoi de code (CI), avec des données inventées
dans chaque table : si une nouvelle table ou colonne n’est pas couverte par
les sauvegardes, la CI échoue avant d’arriver en production. Pour le lancer
sur un fichier téléchargé, il faut une base Postgres vide et jetable (jamais
la vraie : le script refuse Supabase et toute base déjà remplie) :

```bash
CHECK_DATABASE_URL="postgres://…?sslmode=disable" BACKUP_PASSPHRASE="…" npm run db:restore-check -- fichier.agny
```

Une sauvegarde manuelle se fait de la même façon :
`BACKUP_PASSPHRASE="…" POSTGRES_URL_NON_POOLING="…" npm run db:backup`
(le fichier va dans `backups/`, ignoré par git).
