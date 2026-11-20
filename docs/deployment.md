# Déploiement

Deux options, avec le même code. L'infrastructure VEJA impose Cloudflare : l'option A est celle à viser ; l'option B est la plus simple pour démarrer.

## Avant tout : la base

1. Créer un projet Supabase.
2. Exécuter `supabase/schema.sql` dans l'éditeur SQL.
3. Relever l'adresse **Transaction pooler** (Connect > Transaction pooler, port 6543). Elle devient `DATABASE_URL`.

## Option A : Cloudflare Workers (un seul Worker)

Un Worker sert le site statique, l'API sous `/api` et le planificateur (déclencheur chaque minute). Prérequis : **plan Workers payant** (durée et nombre de requêtes d'un scan ; à confirmer avec l'infrastructure).

### Première mise en place (une seule fois)

1. Créer la connexion à la base : `npx wrangler hyperdrive create price-monitoring --connection-string="<DATABASE_URL de Supabase, Transaction pooler>"`. Noter l'identifiant retourné.
2. Enregistrer les clés de l'application comme **secrets du Worker** (jamais dans le dépôt) :
   ```bash
   cd api
   npx wrangler secret put SCRAPINGBEE_API_KEY
   npx wrangler secret put ANTHROPIC_API_KEY     # facultatif
   npx wrangler secret put RESEND_API_KEY        # facultatif (e-mails de récapitulatif)
   ```
3. Régler les variables non secrètes dans la section `[vars]` de `api/wrangler.toml` : `ADMIN_EMAILS`, `APP_URL`, `MAIL_FROM`, plafonds de coût (voir [exploitation](operations.md)). N'y mettez pas d'adresse personnelle si le dépôt est public : utilisez une adresse de groupe.
4. Protéger le domaine avec **Cloudflare Access** (SSO).

### Déployer depuis une archive (ZIP) ou par votre propre chaîne

Le projet se télécharge en ZIP depuis GitHub (Code > Download ZIP) et se déploie par n'importe quelle chaîne (CI de l'entreprise, poste d'un administrateur). L'archive ne contient ni dépendances ni site construit : la chaîne doit les produire. Aucun fichier `.env` n'est nécessaire ni attendu.

Étapes de la chaîne, depuis la racine du projet décompressé :

```bash
npm ci --prefix app
npm ci --prefix api
npm --prefix app run typecheck && npm --prefix api run typecheck   # facultatif
npm --prefix api test                                              # facultatif : test de bout en bout
npm --prefix app run build                                         # produit app/dist
# remplacer REMPLACER_PAR_LID_HYPERDRIVE dans api/wrangler.toml par l'identifiant Hyperdrive, puis :
cd api && npx wrangler@4 deploy
```

La chaîne doit fournir à `wrangler` deux variables d'environnement, à garder dans ses secrets : `CLOUDFLARE_API_TOKEN` (droit « Edit Cloudflare Workers ») et `CLOUDFLARE_ACCOUNT_ID`.

### Déployer depuis un poste

```bash
npm run build
cd api
# renseigner l'identifiant Hyperdrive dans wrangler.toml ([[hyperdrive]] id), puis :
npm run deploy:check   # vérifie le paquet sans publier
npm run deploy
```

**SSO** : Cloudflare Access authentifie l'utilisateur et transmet son adresse dans l'en-tête `Cf-Access-Authenticated-User-Email`, que l'API lit. En production, sans cet en-tête, l'API répond 401. Le SSO simulé est refusé quand `NODE_ENV=production` (toujours le cas dans le Worker).
La déconnexion du site renvoie vers `/cdn-cgi/access/logout` (réglable avec `VITE_LOGOUT_URL` à la construction).

**Scans sous Workers** : un scan demandé depuis l'écran est mis en attente et lancé par le déclencheur planifié, au plus tard à la minute suivante. Un scan interrompu est marqué en échec (jamais relancé automatiquement).

## Option B : serveur Node (un seul programme)

```bash
npm run build
cd api && npm start       # sert l'API et le site construit
```

Variables d'environnement : celles de `api/.env.example`, avec `HOST=0.0.0.0`, `NODE_ENV=production` et **sans** `SSO_SIMULATED`. À héberger sur Fly.io, Railway ou une machine de l'infrastructure ; Cloudflare reste devant pour le domaine et le SSO.

## Droits des utilisateurs

Par défaut, tout utilisateur connecté peut lire et modifier toutes les zones (`DEFAULT_ZONE_ROLE=editor`). Pour restreindre : `DEFAULT_ZONE_ROLE=none` puis une ligne par utilisateur et zone dans `user_zone_access` (rôle `reader`, `editor` ou `admin`). Les adresses de `ADMIN_EMAILS` ont tous les droits.

## Liste de contrôle de mise en service

- [ ] Schéma exécuté, `DATABASE_URL` renseignée
- [ ] Cloudflare Access devant le domaine, adresse transmise à l'API
- [ ] Clé ScrapingBee de production, plafonds de coût réglés
- [ ] `ADMIN_EMAILS` et droits par zone décidés
- [ ] Premier import (catalogue puis comptes) pour chaque zone
- [ ] Scan manuel sur quelques comptes, vérification des relevés et des produits « à identifier »
- [ ] Planificateur observé sur une journée de scan
