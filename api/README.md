# API du suivi des prix

Serveur Hono (Node maintenant, Cloudflare Workers possible plus tard : le code est le même) branché sur Supabase.
Il enregistre les imports et les modifications, lance les scans (ScrapingBee), rapproche les produits et évalue les remises.

## Démarrer

1. `cd api && npm install`
2. Copier `.env.example` en `.env`, puis renseigner :
   - `DATABASE_URL` : Supabase > Project Settings > Database > Connection string, mode « Transaction pooler » ;
   - `SCRAPINGBEE_API_KEY` : sans elle, les scans sont refusés ;
   - `DEV_USER_EMAIL` : votre adresse (en local, remplace le SSO) ; `ADMIN_EMAILS` : les administrateurs.
3. `npm run dev` (API sur http://127.0.0.1:8787)
4. Dans `app/` : `npm run dev:api` (l'application parle à l'API) ; `npm run dev` reste la démonstration sans serveur.

Ne jamais coller la clé ou l'URL de base dans un chat ni dans le code : seulement dans `api/.env` (ignoré par git).

## Ce que fait la collecte

Pour chaque page de site des comptes suivis (un scan = toutes les pages, 4 en parallèle) :

1. Lecture de la page via ScrapingBee, sans rendu JavaScript (1 crédit).
2. Produits lus dans les données structurées (JSON-LD) ; boutiques Shopify : `products.json` (prix barré, SKU, EAN).
3. Rien trouvé : nouvel essai avec rendu JavaScript (5 crédits), mémorisé pour la page ; puis lecture par Claude si `ANTHROPIC_API_KEY` est renseignée.
4. Pages suivantes via le lien « suivant » (8 pages au plus).
5. Rapprochement avec le catalogue : décision déjà prise, EAN, SKU dans la référence ou l'adresse (confirmés), titre identique unique (confirmé), titre proche (à vérifier, avec candidat). Les fiches d'autres marques sont écartées.
6. Relevé ajouté (jamais modifié) et évaluation figée : RRP de la devise de la page, remise autorisée du produit, anomalie ou non.

Un site en échec n'arrête pas le scan (statut « partiel »). Crédits et coût estimé sont notés par page.

## Planification

Chaque minute, pour chaque zone : jour de scan du calendrier (sinon chaque lundi) et heure locale de la zone (5 h par défaut) atteinte → un scan, une seule fois par jour (index unique en base). Au redémarrage, un scan interrompu est marqué en échec.

## Autorisations

Identité : en-tête `Cf-Access-Authenticated-User-Email` (Cloudflare Access) ; en production il est obligatoire. Droits par zone dans `user_zone_access` (lecteur, éditeur, admin) ; sans ligne, `DEFAULT_ZONE_ROLE` s'applique.

## Test

`npm test` joue le parcours complet sur une base locale (schéma réel) avec un faux ScrapingBee : imports, scan partiel, rapprochement, anomalies, décisions et annulation, droits, planificateur.

## Limites connues

- L'historique du graphe avant le premier scan est au prix de référence (aucune remise inventée).
- Les évaluations figées ne sont pas recalculées quand une règle change ; l'application, elle, lit les règles en direct.

## Déploiement Cloudflare (une seule application)

`wrangler.toml` déploie un Worker qui sert le site (`app/dist`), l'API (`/api/*`) et lance les scans chaque minute (déclencheur planifié).
Un scan demandé depuis l'écran est mis en attente puis lancé à la minute suivante au plus tard.
Étapes : voir l'en-tête de `wrangler.toml` (build du site, Hyperdrive vers Supabase, secrets, `npm run deploy`).
`npm run deploy:check` vérifie le paquet sans rien publier. Protéger le domaine avec Cloudflare Access (SSO).
Prérequis : plan Workers payant (durée et nombre de requêtes d'un scan).

## Garde-fous contre l'emballement

Les compteurs sont lus en base à chaque site, donc ils tiennent même si Cloudflare relance le Worker en boucle. Réglages dans `.env` (ou `[vars]` de `wrangler.toml`).

| Garde-fou | Par défaut | Effet |
|---|---|---|
| `SCANS_ENABLED=false` | actif | coupe tout scan, manuel ou planifié |
| Crédits par jour / mois | 5 000 / 60 000 | sites suivants ignorés (« budget ») |
| Budget mensuel d'une zone | `zones.credits_budget_month` | idem, pour cette zone |
| Dépense par jour | 10 $ | idem |
| Délai entre deux scans d'une zone | 30 min | 429 `scan-too-soon` |
| Scans par zone et par jour | 6 | 429 `scan-daily-limit` |
| Revisite d'un même site | 6 h | site ignoré (« recent ») |
| Échecs consécutifs | 8 | coupe-circuit : le reste du scan est ignoré |
| Durée / appels d'un scan | 20 min / 2 000 | idem |
| Crédits par site / appels Claude par scan | 150 / 20 | page ou lecture suivante refusée |

Un scan interrompu est marqué en échec, jamais relancé automatiquement. Le scan planifié est unique par zone et par jour.
Pour couper en urgence sur Cloudflare : mettre `SCANS_ENABLED` à `false` dans les variables du Worker (effet immédiat, sans redéploiement du code).
