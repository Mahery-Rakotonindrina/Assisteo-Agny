# Alerte si le site tombe

Toutes les 10 minutes, GitHub Actions (workflow « Uptime ») vérifie que :

- la page d’accueil répond ;
- l’API répond, avec la base Supabase et Redis (`/api/health?deep=1`).

Après **trois essais ratés** à 45 secondes d’intervalle, il ouvre un ticket
GitHub « 🔴 Le site ne répond plus » qui te mentionne : tu reçois un e-mail,
et une notification si l’app GitHub est sur ton téléphone. Le ticket dit ce qui
ne répond pas. Dès que le site répond de nouveau, il se ferme tout seul avec la
durée de la panne. Une seule alerte par panne, pas une toutes les 10 minutes.

## Mise en place

Rien de plus que la variable `NEXT_PUBLIC_API_URL` déjà mise pour l’APK
(GitHub → Settings → Secrets and variables → Actions → Variables). Le contrôle
ne tourne que sur la branche par défaut (master), après la fusion.

Pour être sûr de recevoir l’e-mail : GitHub → Settings → Notifications →
« Participating, @mentions and custom » coché pour l’e-mail. Pour l’essayer :
onglet **Actions → Uptime → Run workflow**.

## Bon à savoir

- GitHub peut lancer un contrôle avec quelques minutes de retard.
- GitHub suspend les tâches planifiées d’un dépôt public sans aucune activité
  pendant 60 jours : un envoi de code suffit à les relancer.
- Causes fréquentes : un déploiement Vercel raté, un projet Supabase gratuit
  mis en pause après une semaine sans activité, un quota Upstash dépassé.
