# Suivi des prix VEJA Wholesale

Outil interne qui surveille les prix pratiqués par les revendeurs VEJA et signale les produits **trop remisés** ou **vendus en promotion alors qu'ils sont « non soldés »** (carry-over).

- Il visite chaque semaine (ou plus souvent pendant les soldes) les pages VEJA des sites revendeurs.
- Il reconnaît les produits même quand la couleur est renommée, calcule la remise par rapport au prix de référence (RRP) et applique la **remise autorisée** de chaque produit.
- Il produit le rapport du lundi et l'export Excel au format « FOLLOW UP IMAGE ONLINE ».
- Les équipes valident les produits douteux, laissent des commentaires sur les comptes et suivent les anomalies.

Quatre zones, chacune avec ses comptes, son catalogue et son calendrier : **EMEA, LATAM, APAC, NOAM**, plus une vue **Globale** en lecture seule, par produit (SKU). Interface en français, anglais, portugais et espagnol.

## En un coup d'œil

```
 navigateur ──► app/   (React, Vite)        interface, calculs d'affichage
                 │  /api
                 ▼
               api/    (Hono, Node ou Cloudflare Workers)
                 │  ├─ imports, comptes, catalogue, commentaires, décisions
                 │  ├─ scans : ScrapingBee ► lecture des pages ► rapprochement ► évaluation
                 │  └─ garde-fous de coût, planificateur
                 ▼
               Supabase (Postgres)   supabase/schema.sql
```

| Dossier | Contenu |
| --- | --- |
| [`app/`](app/) | Le site (Vite + React + TypeScript). [Détails](app/README.md) |
| [`api/`](api/) | Le serveur : API, collecte, planificateur, garde-fous. [Détails](api/README.md) |
| [`supabase/`](supabase/) | Le schéma de la base (à exécuter dans l'éditeur SQL de Supabase). |
| [`docs/`](docs/) | Architecture, règles métier, déploiement, exploitation. |

## Démarrer en local

Prérequis : Node 22 ou plus, un projet Supabase dont le schéma `supabase/schema.sql` a été exécuté.

```bash
npm --prefix app install
npm --prefix api install
cp api/.env.example api/.env     # puis renseigner DATABASE_URL (voir ci-dessous)
npm run dev                      # API http://127.0.0.1:8787 + site http://127.0.0.1:5173
```

Dans `api/.env`, au minimum :

| Variable | Rôle |
| --- | --- |
| `DATABASE_URL` | Connexion Postgres de Supabase (Connect, Transaction pooler). |
| `SSO_SIMULATED=true` | En local, une page de connexion par e-mail remplace le SSO. Refusé en production. |
| `SCRAPINGBEE_API_KEY` | Nécessaire pour lancer des scans (les imports marchent sans). |
| `ANTHROPIC_API_KEY` | Facultatif : lecture par Claude des pages sans données structurées. |

Ne jamais mettre de clé ou de mot de passe ailleurs que dans `api/.env` (ignoré par git).

Ensuite, dans l'application : choisir une zone, importer le **catalogue** (fichier MASTERFILE ou CARRY OVER LIST) puis la **liste des comptes** (fichier FOLLOW UP IMAGE ONLINE). Les fichiers sont lus dans le navigateur ; seules les lignes validées partent vers le serveur.

`npm run dev:demo` (dans `app/`) lance l'interface avec des données fictives, sans serveur.

## Commandes

| Commande | Effet |
| --- | --- |
| `npm run dev` | API + site en développement |
| `npm run build` | Construit le site (`app/dist`) |
| `npm start` | Serveur Node qui sert l'API **et** le site construit (un seul hébergement) |
| `npm test` | Test de bout en bout de l'API sur une base locale (schéma réel, faux ScrapingBee) |
| `npm --prefix app run typecheck` | Vérification des types du site |
| `npm --prefix api run deploy` | Déploiement Cloudflare Workers ([guide](docs/deployment.md)) |

## Documentation

- [Architecture](docs/architecture.md) : composants, flux de données, modèle de données, décisions techniques.
- [Règles métier](docs/business-rules.md) : SKU, remise autorisée, anomalies, rapprochement des produits, zones et devises.
- [Déploiement](docs/deployment.md) : Cloudflare (Worker unique) ou serveur Node, SSO, secrets.
- [Exploitation](docs/operations.md) : coûts de collecte, garde-fous, dépannage.

## État du projet

Fonctionnel : imports (ajouter ce qui manque ou mettre à jour), retailers, catalogue par zone (ajout et modification dans un panneau), commentaires, calendrier des soldes et rythme habituel des scans, identification des produits, collecte par cran de coût avec lecture complétée par Claude, rapprochement par modèle et couleur, historique des scans et export Excel de l'historique des prix, filtre par saison, alertes « retailers à revoir », e-mail de récapitulatif après chaque scan (opt-in), SSO simulé en local, préférences par utilisateur, garde-fous de coût.

À brancher ou à décider avec l'infrastructure : hébergement (Cloudflare Workers payant ou Node), SSO d'entreprise (Cloudflare Access), droits par zone, clé ScrapingBee de production, service d'envoi des e-mails (Resend, adresse d'expédition sur un domaine vérifié).

Migrations de base à appliquer sur un projet Supabase existant : `supabase/migrations/`. Un projet neuf n'a besoin que de `supabase/schema.sql`.

Usage interne VEJA.
