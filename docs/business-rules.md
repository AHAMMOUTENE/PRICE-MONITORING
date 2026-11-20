# Règles métier

## Zones et devises

Quatre zones : **EMEA, LATAM, APAC, NOAM** (affichées par leur sigle). Chacune a ses comptes, son catalogue, son calendrier de soldes et son heure de scan. La vue **Globale** est en lecture seule et regroupe les produits de toutes les zones par SKU.

**Chaque zone a son propre catalogue**, importé et modifié séparément : les règles (remise autorisée, produits non soldés, saison) sont propres à la zone, même si le fichier importé contient aussi les prix des autres devises. Les colonnes de prix du catalogue affichent par défaut les devises de la zone, et toutes les autres restent disponibles dans « Colonnes ».

Chaque **page de site** d'un compte porte sa **devise** (n'importe quel code ISO à trois lettres) : c'est elle qui sert à comparer le prix affiché au RRP de la même devise. Un compte peut avoir plusieurs pages (par exemple `/fr` en EUR et `/uk` en GBP).

## Identité d'un produit : le SKU

L'identité d'un produit est formée des **9 premiers caractères du SKU**. La lettre qui suit (A, B, C, D) distingue femme, homme et enfant : elle est conservée comme **variante**, mais ne crée pas un autre produit.

## Remise autorisée

Chaque produit porte sa **remise autorisée** :

| Valeur | Sens |
| --- | --- |
| `0` | **Non soldé** (carry-over, liste « à ne pas solder ») : aucune remise tolérée. |
| un pourcentage | Remise maximale tolérée. |
| absente | Produit **non contrôlé** : jamais signalé. |

Il n'y a pas de remise par défaut au niveau de la zone ni de page de réglages : tout se règle dans le catalogue, produit par produit. Un produit a aussi une **saison** (AW26, SS27…) et un indicateur **carry-over** (modifiables à la main dans le catalogue).

## Anomalie

Remise = `(1 − prix affiché / RRP de la devise de la page)`, arrondie à 0,1 %. Une remise inférieure à 1 % n'est pas signalée.

| Cas | Résultat |
| --- | --- |
| Produit non soldé (règle `0`) avec une remise ≥ 1 % | Anomalie « modèle non soldé ». |
| Remise supérieure à la remise autorisée | Anomalie « remise au-delà de l'autorisé ». |
| Pas de règle | Non contrôlé. |
| Pas de RRP dans cette devise | « RRP manquant » : aucune anomalie, à compléter dans le catalogue. |
| Fiche non identifiée | À identifier. |

Un compte **exclu des règles** (outlet, boutique officielle) n'est jamais signalé. Un compte dont le **scan** est désactivé n'est ni visité ni compté.

## Rapprochement des produits

Du plus sûr au moins sûr :

1. **Décision humaine** déjà prise sur cette fiche (alias appris) : confirmé.
2. **EAN** identique : confirmé.
3. **SKU** lisible dans la référence ou l'adresse de la fiche : confirmé.
4. **Modèle ET couleur retrouvés en entier**, dans le titre, la couleur annoncée et les mots de l'adresse (« …/veja-volley-ot-leather-silver-white-natural »), avec un seul produit qui se détache : confirmé.
5. **Titre proche** (modèle trouvé, couleur renommée ou absente) : proposé **à vérifier**, avec le produit le plus probable et un indice de ressemblance.

**Une fiche = un produit, une couleur.** Quand une page présente un même modèle en plusieurs couleurs, chaque couleur devient une fiche à part, avec son adresse, son prix et sa référence. Les pointures d'une même couleur restent une seule fiche.

**Les fiches à vérifier ne se mélangent jamais aux fiches confirmées.** Sur la fiche d'un produit, seules les fiches confirmées comptent dans les prix, le graphe et le nombre de retailers. Les propositions sont listées à part, avec le titre de la fiche du retailer, pour être vérifiées.

Les fiches qui ne ressemblent à aucun produit et ne se présentent pas comme VEJA sont écartées. Dans l'écran « À identifier », l'utilisateur accepte le candidat, désigne un autre SKU ou indique « pas VEJA ». La décision est annulable, et l'outil la retient pour les prochains scans.

## Calendrier et rythme des scans

Hors période de soldes, **un scan chaque lundi**. Pendant une période de soldes, l'équipe choisit les jours de scan (par exemple lundi et jeudi) ou un scan **quotidien** (plus coûteux). Les périodes d'une même zone ne peuvent pas se chevaucher. L'écran affiche une estimation du nombre de scans et de visites de sites.

## Imports

| Fichier | Contenu lu |
| --- | --- |
| **FOLLOW UP IMAGE ONLINE** (retailers) | Nom, site (souvent un lien posé sur le nom), devise, segmentation, commerciaux. Les lignes de titre et de total sont ignorées. |
| **MASTERFILE / CARRY OVER LIST** (catalogue) | SKU (9 caractères), modèle, matière, couleur, saison, EAN, RRP et prix wholesale par devise. Un onglet « carry-over » marque les produits non soldés. |

Deux modes, au choix quand le fichier contient des lignes déjà présentes (**rien n'est jamais supprimé**) :

- **Ajouter ce qui manque** (par défaut) : les lignes nouvelles sont créées ; celles qui existent déjà ne sont **pas modifiées**, sauf pour compléter ce qui manque (un prix dans une devise absente, la page d'un retailer qui n'en avait pas). Les modifications faites à la main sont donc préservées.
- **Mettre à jour avec le fichier** : les valeurs du fichier remplacent celles déjà saisies (seules les valeurs renseignées dans le fichier remplacent).

L'aperçu indique combien de lignes existent déjà ; à la fin, un résumé donne les nombres ajoutés, complétés ou mis à jour, et inchangés.

## Export Excel

Au format « FOLLOW UP IMAGE ONLINE » : une feuille de synthèse par saison (une ligne par compte) et une feuille « Détail » (une ligne par produit et par semaine, avec prix en devise, RRP, remise, remise autorisée).

## Questions encore ouvertes pour les équipes métier

- 70 références « SEASONAL » dans la liste carry-over : 210 non soldés pour 139 marqués carry-over. À confirmer.
- Où corriger les six liens de site cassés du fichier de suivi.
