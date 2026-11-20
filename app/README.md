# Site du suivi des prix

Interface du suivi des prix Wholesale VEJA : Vite, React 18, TypeScript strict. Quatre langues (FR, EN, PT, ES). Vue d'ensemble du projet : [README racine](../README.md).

## Lancer

```bash
npm install
npm run dev         # branché sur l'API (voir ../README.md) : http://127.0.0.1:5173
npm run dev:demo    # données fictives, sans serveur
npm run build       # types + build de production (dist/)
npm run typecheck
```

Par défaut, le site parle à l'API sur `/api` (voir `src/lib/config.ts`) : aucun fichier de configuration n'est nécessaire pour le construire. `npm run dev:demo` lance l'interface avec des données fictives. `VITE_API_URL`, si elle est fournie à la construction, remplace l'adresse par défaut. En développement, Vite relaie `/api` vers l'API locale (`127.0.0.1:8787`).

## Navigation

| Entrée | Écran |
| --- | --- |
| **Tableau de bord** | Quatre indicateurs cliquables, anomalies par semaine, alertes, produits les plus remisés, comptes à traiter. |
| **Notifications** | Alertes à traiter : produits à vérifier, récidives, sites manquants. |
| **Comptes > Rapport** | Un compte par ligne : statut, remise maximale, commentaire, évolution sur 8 semaines. Indicateurs, filtres sur chaque colonne. |
| **Comptes > Liste des comptes** | Gestion : import, interrupteur « scan activé », fiche (pages de site et devises, commerciaux, exclusion des règles). |
| **Fiche compte** | Produits du compte (anomalies, à valider, conformes), commentaires de l'équipe, bouton « Modifier le compte ». |
| **Produits > Rapport** | Un produit par ligne : nombre de comptes, prix le plus bas, remise maximale. Colonnes configurables, tri et filtres. |
| **Produits > Catalogue** | Toutes les données produit (prix RRP et wholesale par devise, saison, carry-over, remise autorisée), modifiables ligne par ligne. Import. |
| **Fiche produit** | Courbes de prix par compte (légende cliquable, bascule de devise), puis une ligne par compte. |
| **Calendrier** | Périodes de soldes et jours de scan, estimation du coût ; ajout dans la page, modification dans un volet. |
| **Logs techniques** | Semaines passées (export Excel) et activité récente. |
| **Vue Globale** | Toutes les zones, par produit (SKU), en lecture seule. |

La semaine consultée est conservée dans l'adresse (`?week=2026-11-09`). La zone, la langue et l'état du menu sont mémorisés ; la langue et le tutoriel vu le sont aussi en base, par utilisateur.

## Première connexion

Un nouvel utilisateur choisit sa langue, puis suit un tutoriel interactif (qu'il peut passer et relancer depuis le menu). Le tutoriel s'adapte à la langue et ne montre que ce qui existe.

## Organisation du code

| Dossier | Contenu |
| --- | --- |
| `src/pages/` | Un fichier par écran ; `settings/` pour le catalogue, la liste des comptes et le calendrier. |
| `src/components/` | Éléments partagés : `DataGrid` (tableau avec filtres sur chaque colonne), `Drawer`, `ImportDrawer`, `Tour`, graphiques… |
| `src/api/index.ts` | Contrat `Api`, état de la zone et calculs des écrans. `http.ts` : écritures vers le serveur. `mock-data.ts` : démonstration. |
| `src/api/rules.ts` | Règle d'anomalie ([règles métier](../docs/business-rules.md)). |
| `src/lib/import-parse.ts` | Lecture des fichiers xlsx et csv, correspondance de colonnes, SKU, saison, devises. |
| `src/lib/xlsx-export.ts` | Export Excel au format « FOLLOW UP IMAGE ONLINE ». |
| `src/i18n/` | Textes : `fr.ts` est la référence, les autres langues doivent avoir les mêmes clés (le compilateur le vérifie). |
| `src/styles/` | Variables de design (`tokens.css`) et feuilles de style. |

## Conventions

- Textes courts, vocabulaire simple, pour des équipes non techniques ; « prix wholesale » (jamais « prix de gros »), « remise autorisée » (jamais « règle de remise »).
- Ajouter un texte : l'ajouter dans les **quatre** fichiers de `src/i18n/`.
- Les montants se formatent avec `formatMoney` (toute devise ISO, sans plantage sur un code inconnu).
- Aucun secret dans ce dossier : tout ce qui est ici est lisible par les utilisateurs.
