# Architecture

## Composants

**Site (`app/`)** : Vite, React 18, TypeScript strict, routage par `#`. Toute la logique d'affichage (anomalies, totaux, filtres, tri, export Excel avec `exceljs`) est dans le navigateur, à partir d'un état de zone renvoyé par l'API. Les fichiers Excel et CSV des imports sont lus dans le navigateur (aperçu, correspondance des colonnes) ; seules les lignes validées partent au serveur.

**API (`api/`)** : [Hono](https://hono.dev), un framework qui tourne à l'identique sous Node et sous Cloudflare Workers.

| Fichier | Rôle |
| --- | --- |
| `src/app.ts` | Toutes les routes HTTP, l'identité (SSO), les droits par zone, les imports, les décisions. |
| `src/state.ts` | L'état d'une zone au format du site (comptes, catalogue, calendrier, commentaires, relevés sur 8 semaines). |
| `src/scrape/scan.ts` | Création et exécution d'un scan, planificateur, reprise après interruption. |
| `src/scrape/fetcher.ts` | Collecte des pages (ScrapingBee) derrière une interface. |
| `src/scrape/extract.ts` | Lecture d'une page : JSON-LD, Shopify `products.json`, Claude en dernier recours. |
| `src/scrape/match.ts` | Rapprochement d'une fiche revendeur avec le catalogue. |
| `src/scrape/evaluate.ts` | Règle d'anomalie (pure, testée). |
| `src/scrape/guard.ts` | Garde-fous de coût. |
| `src/session.ts` | SSO simulé de développement (cookie signé). |
| `src/db.ts` | Accès Postgres : postgres.js en production, PGlite dans les tests. |
| `src/server.ts` / `src/worker.ts` | Entrées Node et Cloudflare Workers. |

**Base (`supabase/schema.sql`)** : Postgres. Vingt tables, `zone_id` partout, UUIDv7, `timestamptz`, prix en `numeric(12,2)`. La sécurité par ligne est activée partout sans politique : seul le serveur lit et écrit (clé d'accès de service), les clés publiques n'ont aucun droit. L'autorisation par zone est vérifiée par l'API.

## Flux d'un scan

1. **Déclenchement** : planificateur (une fois par jour de scan et par zone, à l'heure locale de la zone) ou bouton « Scanner » (manuel).
2. **Création** : un scan et une ligne par page de site des comptes suivis (`scans`, `scan_sites`). L'index unique `(zone, jour)` rend le déclenchement planifié idempotent.
3. **Collecte** par page, par cran de coût : page simple (1 crédit), rendu JavaScript (5), proxy premium (25) ; on ne monte que si la page est refusée ou ne donne aucun produit, et le cran qui a marché est mémorisé. Les données structurées sont complétées par la lecture de Claude quand elles sont trop pauvres. Un modèle présenté en plusieurs couleurs donne une fiche par couleur. Pagination par le lien « suivant ».
4. **Rapprochement** de chaque fiche avec le catalogue : décision humaine déjà prise, EAN, SKU lu dans la référence ou l'adresse, titre identique, titre proche. Les fiches d'autres marques sont écartées.
5. **Écriture** : `listings` (fiche vue), `observations` (relevé de prix, jamais modifié), `observation_evaluations` (évaluation figée : SKU, RRP, règle, remise, anomalie).
6. **Fin** : statut `done`, `partial` (un site en échec ou arrêté par un garde-fou) ou `failed`.

## Modèle de données (essentiel)

| Table | Contenu |
| --- | --- |
| `zones`, `users`, `user_zone_access`, `user_preferences` | Référentiel, identité SSO, droits par zone, langue et tutoriel vu. |
| `accounts`, `account_sites`, `account_comments` | Comptes (revendeurs), leurs pages de site avec **une devise par page**, commentaires libres. |
| `products`, `product_prices`, `product_eans` | Catalogue par zone, prix RRP et wholesale **par devise**, EAN par taille. |
| `sale_periods` | Calendrier des soldes (pas de chevauchement dans une zone), plan de scan. |
| `scans`, `scan_sites`, `listings` | Collecte et fiches vues. |
| `observations`, `observation_evaluations` | Historique en **ajout seul** (déclencheurs qui refusent toute modification). |
| `review_decisions`, `product_aliases` | Décisions humaines d'identification (annulables) et ce que l'outil en retient. |
| `imports` | Journal des imports. |

Les évaluations sont **figées** au moment du relevé. L'application, elle, applique les règles **en direct** : modifier la remise autorisée d'un produit met les écrans à jour immédiatement.

## Choix techniques

- **Hono, Node maintenant, Workers possible** : le même code se déploie sur l'un ou l'autre. Node est plus simple pour démarrer ; Workers demande Hyperdrive (Postgres) et un déclencheur planifié.
- **Pas d'ORM** : requêtes SQL explicites, paramètres simples (listes passées en JSON), compatibles avec les deux pilotes.
- **Imports lus côté navigateur** : aperçu instantané, correspondance de colonnes, aucune lecture de fichier de 30 Mo côté serveur.
- **Pas de seed** : les données viennent des fichiers importés par les équipes.
- **SSO** : l'identité vient de l'en-tête de Cloudflare Access. En local, un SSO simulé (cookie signé) ; interdit en production.
- **Le site dérive tout de l'état de zone** : le serveur ne recalcule pas les écrans, il fournit les relevés, le catalogue et les règles.
