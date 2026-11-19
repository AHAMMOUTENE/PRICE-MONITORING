# Déploiement

Deux options, avec le même code. L'infrastructure VEJA impose Cloudflare : l'option A est celle à viser ; l'option B est la plus simple pour démarrer.

## Avant tout : la base

1. Créer un projet Supabase.
2. Exécuter `supabase/schema.sql` dans l'éditeur SQL.
3. Relever l'adresse **Transaction pooler** (Connect > Transaction pooler, port 6543). Elle devient `DATABASE_URL`.

## Option A : Cloudflare Workers (un seul Worker)

Un Worker sert le site statique, l'API sous `/api` et le planificateur (déclencheur chaque minute). Prérequis : **plan Workers payant** (durée et nombre de requêtes d'un scan ; à confirmer avec l'infrastructure).

```bash
npm run build                                   # construit app/dist
cd api
npx wrangler hyperdrive create price-monitoring --connection-string="<DATABASE_URL>"
# coller l'identifiant retourné dans api/wrangler.toml ([[hyperdrive]] id)
npx wrangler secret put SCRAPINGBEE_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY       # facultatif
npm run deploy:check                            # vérifie le paquet sans publier
npm run deploy
```

Variables non secrètes : section `[vars]` de `wrangler.toml` (`ADMIN_EMAILS`, `DEFAULT_ZONE_ROLE`, plafonds de coût, voir [exploitation](operations.md)).

**SSO** : protéger le domaine avec **Cloudflare Access**. Il authentifie l'utilisateur et transmet son adresse dans l'en-tête `Cf-Access-Authenticated-User-Email`, que l'API lit. En production, sans cet en-tête, l'API répond 401. Le SSO simulé est refusé quand `NODE_ENV=production` (toujours le cas dans le Worker).
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
