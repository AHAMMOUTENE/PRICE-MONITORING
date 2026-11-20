# Exploitation

## Coût d'un scan

Par page de site visitée :

| Poste | Coût |
| --- | --- |
| ScrapingBee, page simple | 1 crédit |
| ScrapingBee, avec rendu JavaScript | 5 crédits |
| ScrapingBee, proxy premium (sites protégés) | 10 à 25 crédits |
| Lecture par Claude (seulement si les données structurées manquent) | quelques centimes la page |

Le serveur monte **par cran** : page simple (1 crédit) ; si la page est refusée (erreur 500, protection anti-robot) ou ne donne aucun produit, rendu JavaScript (5) ; si cela ne suffit pas, proxy premium (25). Il **mémorise** le cran qui a marché pour la page afin de ne plus payer deux fois. Quand les données structurées d'une page sont trop pauvres par rapport au nombre de prix qu'elle affiche (par exemple 5 produits lus sur 24), la lecture est **complétée par Claude**. Les boutiques Shopify sont lues par `products.json` (pas de HTML). Le coût estimé de chaque page est enregistré dans `scan_sites`.

Estimation : `coût d'un scan ≈ nombre de pages × crédits par page × prix du crédit` (réglable avec `SCRAPINGBEE_CREDIT_USD`). L'écran du calendrier donne le nombre de scans et de visites d'une période.

## Garde-fous contre l'emballement

Les compteurs sont lus **en base** à chaque page : ils tiennent même si l'hébergeur relance le programme en boucle. Réglages par variables d'environnement.

| Garde-fou | Variable | Par défaut | Effet |
| --- | --- | --- | --- |
| Interrupteur général | `SCANS_ENABLED` | `true` | `false` coupe tout scan, manuel ou planifié |
| Crédits par jour | `MAX_CREDITS_PER_DAY` | 5 000 | pages suivantes ignorées (`budget-daily`) |
| Crédits par mois | `MAX_CREDITS_PER_MONTH` | 60 000 | idem (`budget-monthly`) |
| Budget mensuel d'une zone | `zones.credits_budget_month` | vide | idem (`budget-zone-monthly`) |
| Dépense par jour | `MAX_COST_USD_PER_DAY` | 10 | idem (`budget-cost-daily`) |
| Délai entre deux scans d'une zone | `SCAN_COOLDOWN_MINUTES` | 30 | refus 429 `scan-too-soon` |
| Scans par zone et par jour | `MAX_SCANS_PER_ZONE_PER_DAY` | 6 | refus 429 `scan-daily-limit` |
| Revisite d'un même site | `SITE_COOLDOWN_HOURS` | 6 | page ignorée (`recent`) |
| Échecs consécutifs | `MAX_CONSECUTIVE_FAILURES` | 8 | coupe-circuit (`circuit-open`) |
| Durée d'un scan | `SCAN_MAX_MINUTES` | 20 | arrêt (`scan-deadline`) |
| Appels d'un scan | `MAX_FETCHES_PER_SCAN` | 2 000 | arrêt (`scan-fetch-limit`) |
| Crédits d'une page | `MAX_CREDITS_PER_SITE` | 150 | page abandonnée |
| Lectures Claude par scan | `MAX_LLM_CALLS_PER_SCAN` | 20 | lecture refusée |

Quand un garde-fou joue, les pages restantes sont marquées « ignoré » avec la raison, et le scan passe en « partiel ». **Rien n'est relancé automatiquement.**

**Coupure d'urgence** : mettre `SCANS_ENABLED=false`. Sur Cloudflare, c'est une variable du Worker, effective sans redéploiement du code.

## E-mail de récapitulatif après chaque scan

Chaque utilisateur peut l'activer **zone par zone** en haut de la page Notifications (désactivé par défaut) et choisir ses rubriques d'actions : retailers à revoir, toujours à corriger depuis le scan précédent, à faire (produits à identifier, retailers sans site). L'e-mail commence par les **indicateurs** du tableau de bord (produits en anomalie et écart avec le scan précédent, nouvelles anomalies, produits à identifier, retailers en discount sur le total suivi), puis liste les **actions à mener**, avec un lien vers chaque retailer et vers l'application, dans la langue de l'utilisateur. Les indicateurs sont toujours présents ; seules les rubriques d'actions se choisissent. Rien n'est envoyé après un scan en échec total, ni à quelqu'un qui ne l'a pas activé.

Pour que les e-mails partent, trois variables dans `api/.env` (ou les secrets Cloudflare) :

| Variable | Rôle |
| --- | --- |
| `RESEND_API_KEY` | Clé du service d'envoi [Resend](https://resend.com). |
| `MAIL_FROM` | Adresse d'expédition, sur un **domaine vérifié** chez Resend (enregistrements DNS à ajouter par l'infrastructure). |
| `APP_URL` | Adresse publique de l'application, utilisée dans les liens. |

Sans elles, le choix des utilisateurs est enregistré mais rien ne part ; la page Notifications le dit.

## Surveiller

- `scans` : statut, nombre de pages faites et en échec, crédits, coût estimé, raison d'arrêt (`error`).
- `scan_sites` : par page, le statut, le code HTTP, les crédits, le nombre de fiches vues, rapprochées et à vérifier, l'erreur.
- Journaux du serveur : une ligne JSON par événement (`scan-finished`, `site-failed`, `scan-refused`…).

## Dépannage

| Symptôme | Piste |
| --- | --- |
| Page blanche en développement | Recharger avec Ctrl+F5 ; sinon relancer `npm run dev` (le serveur garde parfois en mémoire une version vide d'un fichier modifié sur OneDrive). |
| « Le serveur est injoignable » | L'API n'est pas lancée, ou `DATABASE_URL` est fausse. |
| « Sign in » à chaque rechargement | Le SSO simulé garde la session dans un cookie ; après un redémarrage de l'API, il faut se reconnecter. |
| Scan refusé (422 `scraping-not-configured`) | `SCRAPINGBEE_API_KEY` absente. |
| Toutes les pages « fetch failed », 0 crédit | Réseau d'entreprise qui inspecte le trafic sécurisé : Node refuse son certificat (`SELF_SIGNED_CERT_IN_CHAIN`). Lancer avec `NODE_USE_SYSTEM_CA=1` (déjà fait par `npm run dev`). N'utilisez jamais `NODE_TLS_REJECT_UNAUTHORIZED=0` : la clé ScrapingBee passe dans l'adresse. |
| Une page revient toujours « vide » | Site protégé ou chargé en différé : renseigner `fetch_options` de la page (`renderJs`, `premiumProxy`, `countryCode`) dans `account_sites`. |
| Beaucoup de produits « à identifier » | Compléter les EAN et les couleurs du catalogue ; les décisions humaines sont retenues pour les scans suivants. |

## Sauvegardes et données

La base Supabase est la seule source de vérité. Les relevés (`observations`) sont en ajout seul. Les fichiers Excel des équipes ne sont **jamais** versionnés dans ce dépôt (`.gitignore`) : ils s'importent depuis l'application.
