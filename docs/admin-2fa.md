# Double authentification de l’admin

Avec la double authentification, ouvrir `/admin` demande le jeton
d’administration (`ADMIN_TOKEN`), **puis** un code à 6 chiffres qui change
toutes les 30 secondes sur ton téléphone. Un jeton volé ne suffit plus.

## L’activer

1. Installe une appli d’authentification : Google Authenticator, Microsoft
   Authenticator, ou l’app **Mots de passe** de l’iPhone (iOS 18 et plus).
2. Dans **Admin → Double authentification → Activer**, scanne le QR code avec
   l’appli. Sur le téléphone lui-même, touche « ouvrir dans l’appli » ou
   saisis la clé à la main.
3. Saisis le code affiché par l’appli : la double authentification est active.
4. **Garde les 10 codes de secours** affichés une seule fois (gestionnaire de
   mots de passe). Chacun remplace une fois le code de l’appli si tu perds ton
   téléphone.

Il faut `API_KEYS_SECRET` sur Vercel (déjà là pour les clés IA des abonnés) :
il chiffre le secret de la double authentification, gardé dans Redis.

## Au quotidien

- Connexion : jeton, puis code. La session dure 12 heures au plus et se ferme
  avec l’onglet.
- Chaque code ne sert qu’une fois. Dix essais au plus par quart d’heure.
- Désactiver ou régénérer les codes de secours redemande un code.

## L’annonce automatique de l’APK

Le workflow qui publie l’APK annonce la nouvelle version à l’admin. Une fois la
double authentification active, il lui faut, en plus du secret GitHub
`ADMIN_TOKEN`, le secret `CRON_SECRET` (déjà mis pour les rappels). Sans lui,
le workflow le signale et tu mets la version à la main dans l’admin.

## Téléphone et codes de secours perdus

Dernier recours : dans la console Upstash (accessible depuis Vercel → Storage →
ta base Redis), onglet Data Browser, supprime la clé `config:admin-2fa`. La double authentification
est alors désactivée : connecte-toi avec le jeton seul, puis réactive-la.
Change aussi `ADMIN_TOKEN` sur Vercel si tu crains qu’il ait fuité.
