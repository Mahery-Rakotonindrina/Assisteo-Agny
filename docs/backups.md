# Sauvegardes de la base de données

L’offre gratuite de Supabase ne propose pas de sauvegardes téléchargeables.
Une fois par semaine (dimanche, 3 h UTC), GitHub Actions exporte les données
des comptes, les chiffre et garde le fichier 90 jours.

## Ce qui est sauvegardé

- L’historique des analyses (avec les conversations et les rappels).
- Les réglages et les clés IA personnelles (déjà chiffrées par le serveur).
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

Une sauvegarde manuelle se fait de la même façon :
`BACKUP_PASSPHRASE="…" POSTGRES_URL_NON_POOLING="…" npm run db:backup`
(le fichier va dans `backups/`, ignoré par git).
