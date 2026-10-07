# E-mails de connexion : passer sur ton propre domaine

Aujourd’hui les codes de connexion partent de Gmail (SMTP configuré dans
Supabase). Ça marche, mais à plus grande échelle Gmail limite les envois
(~500/jour) et les messages finissent plus souvent en spam. La solution :
envoyer depuis un domaine à toi, via Resend.

## 1. Un nom de domaine

Achète un domaine (par ex. `assisteo.mg` ou `assisteo-agny.com`) chez un
registrar (Namecheap, OVH, Cloudflare…). Un sous-domaine suffit pour les
e-mails : on utilisera `mail.ton-domaine`.

## 2. Resend

1. Crée un compte sur https://resend.com (gratuit : 3 000 e-mails/mois, 100/jour).
2. **Domains → Add domain** → `mail.ton-domaine`.
3. Ajoute chez ton registrar les enregistrements DNS affichés (SPF, DKIM,
   et MX de retour). Attends le statut **Verified**.
4. **API Keys → Create API key** (permission *Sending access*, limitée à ce domaine).

## 3. Supabase

**Project Settings → Authentication → SMTP Settings** :

| Champ          | Valeur                                   |
| -------------- | ---------------------------------------- |
| Sender email   | `no-reply@mail.ton-domaine`              |
| Sender name    | `Assisteo Agny`                          |
| Host           | `smtp.resend.com`                        |
| Port           | `465`                                    |
| Username       | `resend`                                 |
| Password       | la clé API Resend                        |

Puis **Authentication → Rate Limits** : remonte *Emails sent per hour*
(Supabase le bloque à 2/heure tant que le SMTP par défaut est utilisé).

## 4. Le modèle d’e-mail

**Authentication → Emails → Templates** : colle
[`supabase/templates/sign-in-code.html`](../supabase/templates/sign-in-code.html)
dans **Magic Link** et dans **Confirm signup**, avec pour sujet :

```
Ton code Assisteo Agny : {{ .Token }}
```

L’app se connecte avec le code à 6 chiffres, jamais avec le lien : le modèle
ne contient donc que `{{ .Token }}`.

## 5. Vérifier

Dans l’app : Réglages → Se connecter → ton e-mail. Le code doit arriver en
quelques secondes, expéditeur `no-reply@mail.ton-domaine`, hors spam. Dans
Resend, l’onglet **Emails** montre chaque envoi et son statut.
