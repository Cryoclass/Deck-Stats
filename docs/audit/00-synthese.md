# Synthèse de l'audit — Testhand en freemium

## 1. Dédoublonnage et arbitrage

### 1.1 Convention d'identifiants

Matière : les six volets `00` à `05` de `docs/audit/`, rien d'autre. Code audité par les volets : `main` à `cff8a75`, identique à la prod déclarée `4cf9493`.

| Préfixe | Volet | Règle de numérotation |
|---|---|---|
| MAT-§n | 00-materiaux.md | Section du volet ; ce volet n'a presque aucun constat propre (seulement §5 « Observations » et §6 npm audit) |
| VIS-nn | 01-visuel.md | Le volet n'a **aucun identifiant** : numérotation par la synthèse, dans l'ordre d'apparition, avec la section d'origine (§1.2) |
| PAR-nn | 02-parcours.md | Ligne nn du « Tableau des frictions ». Le texte du volet cite des F-numéros qui ne suivent pas l'ordre du tableau (F5 = ligne 6, F12 = ligne 7, F11 = ligne 11) ; la synthèse suit **l'ordre du tableau**. PAR-NVn = point n de « Non vérifié / écarté » |
| DON-Bn · DON-An · DON-Kn · DON-Rn · DON-P2a/b | 03-donnees-conformite.md | B1–B6 = §0 blocages ; A1–A9 = §3 alternatives ; K1–K4 = §4.4 recommandations catalogue ; R1 = §5.5 art. 32 (archives en clair sur le poste), R2 = §5.5 minimisation (sessions expirées, user-agent), R3 = §5.5 art. 30 / 28 / 33 (registre, contrats, violation) ; P2a = §6 rétention `keep/`, P2b = §6 clé anon |
| PER-On · PER-An/Dn/Bn/Mn/Gn/Hn · PER-Xn · PER-Qn | 04-permissions.md | Identifiants du volet, préfixés (O = portes §3, lettres = inventaire §2, X = axes §5, Q = questions §7) |
| COD-Cn | 05-code.md | C1–C21 |

### 1.2 Index des constats visuels (volet 01, numérotés ici)

| ID | Section | Constat |
|---|---|---|
| VIS-01 | §3 | Trois gris (`ink-400/500/600`, 4,2 / 2,5 / 1,7:1) portent de l'information ; 55 % des styles de texte de l'éditeur à 1440 sous 4,5:1 |
| VIS-02 | §2.2 | 38 % des textes à 10 px à 1440, 16 % à 9 px à 360 ; 159 tailles arbitraires hors échelle ; aucun titre |
| VIS-03 | §4, §5 | Mobile : 266 px de chrome sur 780 (34 %) avant la première carte ; 45 % des cibles < 32 px |
| VIS-04 | §2.1 | Aucune variable CSS ; rôles = classes Tailwind répétées ; formule de carte de chaleur dupliquée dans deux fichiers |
| VIS-05 | §4 | Jargon interne affiché : « (§3.3) », « (§D) », « (§E) », « contrat §2 », « E[red.] », « C(D,5) » |
| VIS-06 | §4 | Connexion : ni promesse, ni aperçu, ni prix, ni lien légal, ni mot de passe oublié ; code d'invitation ; Discord plus fort que l'action primaire |
| VIS-07 | §4, §6 | Accueil : libellés des deux seuls chiffres à 9 px `ink-600` (1,66:1) ; bandeau coupé ; aucun tri ni filtre |
| VIS-08 | §4 | Nouveau deck : `<input type=file>` natifs ; libellé en capitales sur deux lignes ; « Créer un deck vide » en lien fantôme |
| VIS-09 | §4 | En-tête à 3 lignes à 360 ; onglets masqués (208 px) sans indice ; raccourcis `<kbd>` affichés sur mobile |
| VIS-10 | §4 | Badges S / H / Fx / Pc posés sur le nom de la carte ; delta à 10 px `ink-500` ; stepper sans contraste de fond |
| VIS-11 | §4, §6 | Panneau : la statistique principale (≥ 1 départ) à 12 px `ink-400`, le résultat de requête à 20 px ; colonne « cumulé » la plus effacée |
| VIS-12 | §6 | En-têtes de tableau au gris le plus faible ; cellules chaudes de la matrice à 2,8–4,4:1 ; 9 px sous 640 ; « · » et légende Δ non expliqués |
| VIS-13 | §4 | Plans de side à 360 : 48 vignettes de 56 px avant le plan ; marqueurs « sort / entre » à 10 px |
| VIS-14 | §4 | Comparateur : bandeaux rendus avant tout contenu (cinq bandeaux plein écran sur decks identiques) |
| VIS-15 | §2.4 | `outline-none` ×14 sans `:focus-visible` ; aucun `role="dialog"` ; Échap incohérent ; `lang="en"` ; aucun favicon ni manifest ; 106 `title=` inaccessibles au toucher ; `h-screen` sans `dvh` |
| VIS-16 | §4 | Deck vide = trois bandeaux d'erreur ; « Deck introuvable » sans cadre |
| VIS-17 | §2.2 | `font-num` (JetBrains Mono) déclarée, jamais chargée |
| VIS-18 | §5 | Tablette 768 : panneau de stats replié en onglet malgré la place |
| VIS-19 | §4 | Mur de mains : deux tiers vides à 1440 ; pastille de note domine |
| VIS-20 | §7, §8 | Recommandation : garder le sombre, direction A (trois rôles de texte ≥ 4,5:1, corps 13 px, variables CSS) ; direction B écartée |

### 1.3 Fusions

| Élément fusionné | IDs portés | Ce que chaque volet ajoute |
|---|---|---|
| Hotlink du CDN YGOPRODeck et relais sans cache | DON-B1, DON-A1, PER-O6, PER-G4, PER-D20, COD-C10 (`img-src`) | 03 : interdiction publiée, 23 requêtes par parcours, IP et Referer transmis ; 04 : relais joignable anonymement et sans limite ; 05 : la CSP devra citer l'hôte tant qu'A1 n'est pas fait |
| Garde contournable par `/%61pi/` | PER-O1, PER-G2, PER-G4 ; revérifié par 05 (rang 2) | 04 : mécanisme et sondes, y compris à travers Caddy ; 05 : revérifié sur l'image de prod reconstruite |
| Inscription fermée, code partagé, email non vérifié | PAR-01, PER-O12, PER-A2, PER-Q3, COD-C18, VIS-06 | 02 : bloque 100 % des inscriptions organiques ; 04 : code réutilisable, 5 comptes / IP / 10 min ; 05 : le 409 révèle l'existence d'un compte dès l'ouverture ; 01 : la page ne dit pas comment obtenir un code |
| Droits sur son compte | DON-B4 (art. 15–17), PAR-02, PER-A6, VIS-06 | 03 : routes à créer et bases légales ; 02 : client payant verrouillé dehors ; 04 : jamais derrière le payant |
| Textes légaux et attribution | DON-B4 (art. 13), DON-A8, VIS-06, PER-§4.2 | 03 : pages et liens ; 01 : aucun lien sur la connexion |
| Erreurs internes renvoyées au client | PER-O10, PAR-11, PER-D4, PER-G2, COD-C4 (gestionnaire) | 02 : message Postgres brut vu à l'écran ; 04 : `limit=-1` → 500, DELETE d'autrui → 200 ; 05 : aucune classification des erreurs |
| Configuration non bornée, SQL ligne à ligne, pool saturé, effondrement | PER-O2, PER-O3, PER-D6, PER-Q1, COD-C3 | 04 : 10 min de transaction, `/me` d'un autre compte à 16 s ; 05 : effondrement à 75 req/s, variante en lot mesurée (p50 divisé par 60) |
| Journaux IP sans durée ni rotation | DON-B5, COD-C4 (journaux) | 03 : preuve d'exécution, contradiction avec AGENTS.md:60 ; 05 : 412 octets par requête, pilote sans rotation |
| Sauvegardes sur un seul lieu | COD-C5, DON-R1, DON-P2a | 05 : même VPS, perte 24 h, tout-ou-rien ; 03 : archives de prod en clair sur le poste, `keep/` hors rétention |
| Catalogue dépendant d'un projet tiers | DON-B3, DON-A9, DON-K1..K4, DON-P2b | 03 seul ; regroupé parce que le même script est touché |
| Textes libres sans borne et validation client en retard | PER-O11, PER-O15, PER-D5, D9, D12, D14, D16, PER-B1, PER-B5 | 04 seul ; regroupé par correctif (`parseConfiguration`) |
| Coût de la connexion et limites par IP | PER-O9, PER-A3, COD-C19, PAR-NV1 | 04 : scrypt 128 Mio anonyme ; 05 : NAT de salle de tournoi ; 02 : hypothèse, confirmée par 05 |
| Aucun rôle, offre, quota, paiement | PER-O4, PER-A7, PER-H1, PER-§4.1–4.4, PER-Q4, DON-§5.4 | 04 : modèle de rôles et emplacements ; 03 : données à stocker en freemium |
| Déconnexion globale, suspension | PER-O13, PER-A5, PER-H2 | 04 seul ; lié à COD-C2 (même déclencheur) |
| Sessions expirées jamais purgées | DON-R2, COD (rang 27), COD-§3.4 [J] | 03 : minimisation ; 05 : index manquant si une purge est ajoutée |
| Onglets mobiles hors champ | PAR-06, VIS-03, VIS-09 | 02 : « Plans de side » invisible au chargement ; 01 : 208 px masqués, 34 % de chrome |
| Deck vide sans issue | PAR-03, PAR-04, VIS-16 | 02 : message contradictoire, 0 % sans cause ; 01 : trois bandeaux d'erreur |
| « Créer un deck vide » invisible | PAR-10, VIS-08 | même dialogue |
| Jargon et absence de glossaire | VIS-05, PAR-05 | 01 : occurrences précises ; 02 : « brick » et « starter » expliqués nulle part |
| Explications réservées au survol | PAR-07, VIS-15 (`title=`) | 02 : « Comparer » désactivé ; 01 : 106 attributs |
| Moteur sans borne de coût | PER-O7, COD-C14, PER-M1, PER-M2, PER-Q2 | 04 : bornes extrêmes ; 05 : decks réalistes (14 s par clic), aperçus en série |
| Vulnérabilités npm | COD-C16, MAT-§6 | 00 : 12 vulnérabilités brutes ; 05 : 4 en prod, non atteignables |
| Direction A (rôles de texte et de couleur) | VIS-01, VIS-02, VIS-04, VIS-17, VIS-20, parts contraste de VIS-07, VIS-10, VIS-12 | un seul chantier de tokens |

### 1.4 Arbitrages de la synthèse

- **DON-B3 (catalogue) n'est pas un verrou de vente.** Le volet 03 le range parmi ce qui « empêche de vendre ». La synthèse le classe « avant les 100 premiers utilisateurs » : le calcul reste exact sans catalogue à jour, le risque se matérialise à la prochaine sortie de set, pas à la première facture.
- **Le visuel et le parcours ne sont pas des verrous.** Ils décident de la rétention, pas de la possibilité de vendre. Ils forment l'essentiel du deuxième chantier.
- **COD-C6 et COD-C7 (tests, CI) ne sont pas des verrous.** Le code actuel est juste (160 761 vérifications, 0 divergence). Le risque naît à la prochaine modification, donc avant les premiers utilisateurs, pas avant la première vente.
- **Le chantier « avant toute mise en vente » contient trois éléments non bloquants** (PER-O10, PER-O5, VIS-05) parce que leurs volets les classent P0 ou « à retirer avant toute mise en vente » et qu'ils touchent les mêmes fichiers que les verrous.
- **Gravités.** Les volets 02, 04, 05 gradent ; 03 ne grade pas ses blocages (traités « Critique ») ; 01 ne grade rien : les gravités VIS sont **attribuées par la synthèse** et marquées d'un astérisque. Échelle unique : Critique > Haute (= « Élevée » du volet 02) > Moyenne > Faible.
- **Efforts.** Seul le volet 03 chiffre en jours. Partout ailleurs la colonne porte « non renseigné », y compris pour des correctifs d'une ligne : la synthèse n'estime pas à la place des volets.
- **04 « isolation entre comptes solide » et 05 C2 « fuite entre comptes »** ne se contredisent pas : l'isolation de l'API tient (sonde P3), la fuite est dans le navigateur (store et brouillons non vidés sur 401).
- **Les axes PER-X1..X8** sont des options produit, pas des défauts : hors backlog. Seuls leurs prérequis (PER-O7, PER-O8) y figurent.

## 2. Les cinq verrous

| # | Verrou | Constat | Si on vend quand même | Ordre de grandeur du travail | IDs |
|---|---|---|---|---|---|
| 1 | **Visuels et textes de Konami servis par un CDN qui interdit le hotlink** | Chaque navigateur charge les cartes complètes depuis `images.ygoprodeck.com` (23 requêtes par parcours), le relais serveur refait un appel amont à chaque fois, le PDF embarque les illustrations ; aucun accord, aucune mention, et la tolérance de Konami telle que relayée exclut la monétisation. | Un blocage d'IP (du VPS ou par Referer) casse d'un coup toutes les illustrations de tous les clients payants ; une mise en demeure suit le précédent Dueling Network (2016) sur un produit devenu trouvable dès que le `noindex` est levé. | Décision d'abord. Minimum technique A1 (cache disque) : 1 à 1,5 j. Voie « accord » : 0,5 j de code, délai et issue inconnus. Voie « sans visuels » A3 + A4 + A6 + A8 + A9 : 9 à 13 j. | DON-B1, DON-B2, DON-A1, DON-A3..A9, PER-O6, PER-G4, PER-D20 |
| 2 | **Aucun mécanisme de vente** | L'inscription exige un code partagé et réutilisable ; l'email n'est pas vérifié ; il n'existe ni rôle, ni offre, ni quota, ni paiement : un compte crée 300 decks en 8,5 s et rien ne distingue gratuit, payant, admin. | On ne peut ni encaisser ni limiter l'offre gratuite ; si le code fuit, comptes illimités (5 par IP toutes les 10 min) avec l'email de n'importe qui ; la « rétrogradation » d'un abonné n'a aucune règle. | Non chiffré par les volets. Le volet 04 §4.4 décrit six pièces neuves (migration 005, session, garde, `entitlements.ts`, débits par compte, interface), auxquelles s'ajoutent le prestataire de paiement et son webhook, et la vérification d'email (2 à 3 j, volet 03). C'est le seul verrou qui crée au lieu de corriger : un chantier de semaines, pas de jours. | PAR-01, PER-O12, PER-O4, PER-A2, PER-A7, PER-H1, PER-§4.1–4.4, PER-Q3, PER-Q4, COD-C18, DON-§5.4 |
| 3 | **Obligations envers un consommateur non tenues** | Aucune suppression, export, rectification ni réinitialisation de compte ; ni mentions légales, ni CGU/CGV, ni politique de confidentialité ; IP et URL journalisées sans durée ; hébergeur OVH constaté alors que le brief dit Azure. | Un client payant verrouillé dehors n'a que le support manuel ; chaque demande RGPD se traite en SQL sur la prod ; vente à des consommateurs sans CGV ni mentions ; une politique de confidentialité écrite sur un hébergeur faux. | 2 à 3 j (droits du compte) + 2 à 3 j (réinitialisation et vérification d'email, nouveau sous-traitant emails) + 0,5 j (intégration des textes) + 0,5 j (journaux) + 0,5 j (attribution). Les textes juridiques sont à faire rédiger hors développement. | DON-B4, DON-B5, DON-B6, DON-A8, PAR-02, PER-A6, VIS-06, COD-C4 (journaux) |
| 4 | **Un seul inconnu gèle l'API ou lit le deck d'un autre** | Une inscription avec 256 000 « @ » gèle toutes les routes 44 s (1 Mio ≈ 12 min) ; `/%61pi/…` livre le catalogue sans session ; après un 401 le compte suivant voit le deck du précédent ; une seule requête de 1 Mio tient une transaction 10 min et un compte sature le pool de 10 pour tout le monde ; effondrement à ≈ 300 utilisateurs actifs. | La première personne malveillante, ou un simple script, met le service hors ligne pour les clients payants ; un onglet oublié dans une boutique de tournoi livre la stratégie d'un joueur au suivant ; une sortie de set fait tomber toutes les routes, connexion comprise. | Non chiffré par les volets. Les correctifs sont localisés et déjà prototypés : borne de longueur avant la regex, garde sur la route résolue, rechargement sur 401, écriture en lot validée 14 / 14 par le volet 05, délais SQL et pool dimensionné. Des jours, pas des semaines. | COD-C1, PER-O1, COD-C2, PER-O2, PER-O3, COD-C3, COD-C8, PER-O10, PER-O5 |
| 5 | **Exploitation aveugle, sauvegardes sur le seul VPS** | Aucune sonde ni alerte ; healthcheck sans effet (un conteneur « unhealthy » tourne indéfiniment) ; journaux sans rotation (≈ 300 Mo par jour à 100 utilisateurs actifs) ; sauvegardes sur le même disque, perte jusqu'à 24 h, restauration tout-ou-rien ; l'API s'arrête si PostgreSQL redémarre. | Une panne n'est vue que quand un client écrit ; un disque plein arrête PostgreSQL ; une perte du VPS emporte base et sauvegardes de tous les clients ; « j'ai supprimé mon deck » ramène tout le monde à la veille. | 0,5 j (journaux, volet 03). Sonde externe, alerte, `pool.on('error')`, arrêt gracieux et copie hors VPS : non chiffrés, mais ce sont des lignes de compose, un gestionnaire de signal et un `rclone copy` dans `backup.sh`. | COD-C4, COD-C5, COD-C8, DON-B5, DON-R1, DON-P2a |

Écartés du top 5, à dessein : le visuel et le mobile (VIS-01..03, rétention et non vente), les tests et la CI (COD-C6, COD-C7 : le code actuel est juste, le risque est à la prochaine modification), le catalogue (DON-B3 : risque à la prochaine sortie de set).

## 3. Backlog unifié

Tri : bloque la vente (Oui d'abord), puis gravité décroissante, puis effort croissant (chiffré avant « non renseigné »). Chantiers : **V** = avant toute mise en vente · **U** = avant les 100 premiers utilisateurs · **T** = plus tard · **Aucun (§6)** = défendable de ne jamais traiter. Gravité marquée `*` = attribuée par la synthèse (volet 01 sans échelle).

| ID(s) | Titre | Axe | Gravité | Effort | Bloque la vente | Chantier |
|---|---|---|---|---|---|---|
| DON-B2 · DON-A3 · DON-A4 · DON-A6 · DON-A7 · DON-P0 | Stratégie des visuels et textes de Konami à trancher : accord écrit (A7) ou retrait (A3 + A4 + A6) | Données · PI | Critique | Décision ; puis 0,5 j (A7) ou 9 à 13 j (sans visuels, A8 et A9 compris) | Oui | V |
| DON-B6 | OVH constaté, Azure évoqué : lever l'écart avant toute politique de confidentialité ou registre | Données · RGPD | Critique | Décision | Oui | V |
| DON-B4 (art. 13) · DON-A8 · VIS-06 · PER-§4.2 | Ni mentions légales, ni CGU/CGV, ni politique de confidentialité, ni attribution / non-affiliation (écran, en-tête, PDF) | Données · visuel | Critique | 0,5 j (intégration) + 0,5 j (attribution) ; textes juridiques par un tiers | Oui | V |
| DON-B1 · DON-A1 · PER-O6 · PER-G4 · PER-D20 · COD-C10 (`img-src`) | Hotlink du CDN YGOPRODeck depuis chaque navigateur ; relais serveur sans cache ni limite, IP du VPS bannissable | Données · permissions | Critique | 1 à 1,5 j (A1) | Oui | V |
| DON-B4 (art. 15–17) · PAR-02 · PER-A6 | Aucun droit sur son compte : suppression, export, rectification, changement et réinitialisation de mot de passe, email vérifié | Données · parcours | Critique | 2 à 3 j (droits) + 2 à 3 j (réinitialisation, vérification, prestataire d'emails) | Oui | V |
| COD-C1 | Une inscription avec un email de 256 000 « @ » gèle toute l'API 44 s (1 Mio ≈ 12 min, extrapolé) | Code · sécurité | Critique | non renseigné | Oui | V |
| PER-O1 · PER-G2 · PER-G4 | Garde d'authentification contournée par `/%61pi/…` : catalogue, textes d'effet et relais d'images sans session, y compris à travers Caddy | Permissions | Critique | non renseigné | Oui | V |
| PAR-01 · PER-O12 · PER-A2 · PER-Q3 · COD-C18 · VIS-06 | Inscription fermée par un code partagé et réutilisable ; email non vérifié ; le 409 révèle l'existence d'un compte | Parcours · permissions | Critique (02) / Moyenne (04) | non renseigné | Oui | V |
| COD-C2 | Après un 401 dans un onglet, le compte suivant voit le deck du précédent (nom, 20 tuiles, annotations, statistiques) | Code · isolation | Haute | non renseigné | Oui | V |
| PER-O2 · PER-O3 · PER-D6 · PER-Q1 · COD-C3 | Configuration sans borne, une instruction SQL par ligne, pool de 10 : un compte bloque tous les autres ; effondrement à 75 req/s (≈ 300 actifs) | Permissions · code | Haute | non renseigné (variante « écriture en lot » écrite et validée 14 / 14 par le volet 05) | Oui | V |
| COD-C4 · DON-B5 | Aucune sonde ni alerte ; healthcheck sans effet ; journaux IP + URL sans rotation (412 octets par requête) | Code · exploitation · RGPD | Haute | 0,5 j (journaux) ; sonde et alerte non renseigné | Oui | V |
| COD-C5 · DON-R1 · DON-P2a | Sauvegardes sur le seul VPS, perte jusqu'à 24 h, restauration tout-ou-rien ; `keep/` sans rétention ; archives de prod en clair sur le poste | Code · exploitation · RGPD | Haute | 0,5 j (`keep/`, archives) ; copie hors VPS non renseigné | Oui | V |
| COD-C8 | Arrêt de l'API si PostgreSQL redémarre (`pool.on('error')` absent) ; SIGTERM ignoré (SIGKILL après 10 s) ; aucun délai de requête ni SQL | Code · exploitation | Moyenne | non renseigné | Oui | V |
| PER-O4 · PER-A7 · PER-H1 · PER-§4.1–4.4 · PER-Q4 · DON-§5.4 | Aucun rôle, offre, quota ni paiement ; 300 decks en 8,5 s, 500 étiquettes en 9,2 s sans refus | Permissions | Moyenne (04) | non renseigné | Oui | V |
| PER-O10 · PAR-11 · PER-D4 · PER-G2 | Erreurs internes renvoyées telles quelles (codes SQL, noms de contraintes) ; `limit=-1` → 500 ; DELETE d'autrui → 200 | Permissions · parcours | Haute (02) / Moyenne (04) | non renseigné | Non | V |
| PER-O5 · PER-B2 · PER-B5 | UUID choisis par le client dans des tables à clé globale : oracle d'existence entre comptes, 500 | Permissions | Moyenne | non renseigné | Non | V |
| VIS-05 | Jargon interne affiché à l'utilisateur : « (§3.3) », « (§D) », « (§E) », « contrat §2 », « E[red.] », « C(D,5) » | Visuel | Moyenne* | non renseigné | Non | V |
| DON-B3 · DON-A9 · DON-K1 · DON-K2 · DON-K4 · DON-P2b | Catalogue tiré d'une Supabase personnelle d'un autre projet, clé anon en dur dans le dépôt, mise à jour manuelle, version invisible, 192 passcodes provisoires | Données | Critique (03) | 2 à 2,5 j (A9 + cron + version) + 0,25 j (clé) | Non | U |
| COD-C7 | Ni test de la garde, des sessions, de l'inscription ni de Discord ; aucune CI ; `main` déployée sans vérification | Code · qualité | Haute | non renseigné | Non | U |
| COD-C6 | Chemin applicatif du calcul non gardé : 9 mutants sur 55 survivent (paire désactivée, mortes inversées, Redondance, sélecteurs, mur) | Code · qualité | Haute | non renseigné (test différentiel écrit par le volet 05, ≈ 30 s pour 300 decks) | Non | U |
| VIS-01 · VIS-02 · VIS-04 · VIS-17 · VIS-20 (+ contraste de VIS-07, VIS-10, VIS-12) | Direction A : trois gris porteurs d'information sous 4,5:1, 38 % du texte à 10 px, aucune variable CSS ; 186 `text-ink-400/500/600` et 159 tailles arbitraires à remapper | Visuel | Haute* | non renseigné | Non | U |
| VIS-03 · VIS-09 · PAR-06 | Mobile : 34 % de l'écran en chrome à 360, « Inventaire » coupé et « Plans de side » hors champ sans indice, 45 % des cibles < 32 px, raccourcis clavier affichés | Visuel · parcours | Haute (02) | non renseigné | Non | U |
| PAR-03 · PAR-04 · VIS-16 | Deck vide : le message renvoie à l'import qu'on vient de refuser ; 0 % / « brick 100 % » sans dire qu'aucun starter n'est annoté ; trois bandeaux d'erreur | Parcours · visuel | Haute (02) | non renseigné | Non | U |
| PER-O11 · PER-O15 · PER-D5 · PER-D9 · PER-D12 · PER-D14 · PER-D16 · PER-B1 · PER-B5 | Textes et structures sans borne (nom affiché 100 Kio, notes 900 Kio, clés de sujet libres, caractères de direction) ; validation client en retard (min > max bloque l'enregistrement, nom > 200 arrête les brouillons) | Permissions | Moyenne | non renseigné | Non | U |
| PER-O9 · PER-A3 · COD-C19 · PAR-NV1 | Connexion : scrypt de 128 Mio par tentative anonyme, 4 fils libuv saturés ; limites par IP seule, partagées par une salle de tournoi | Permissions · code | Moyenne | non renseigné | Non | U |
| PER-O13 · PER-A5 · PER-H2 | Ni déconnexion de toutes les sessions, ni suspension d'un compte par un admin | Permissions | Moyenne | non renseigné | Non | U |
| DON-R2 · COD (rang 27) | Sessions expirées jamais purgées ; user-agent conservé sans usage | Données · RGPD | Moyenne (P1) | 0,5 j | Non | U |
| DON-R3 | Registre des traitements, contrats de sous-traitance (OVH, paiement, emails), procédure de violation : absents | Données · RGPD | Moyenne | non renseigné | Non | U |
| COD-C10 | Aucun en-tête de sécurité HTTP (CSP, `frame-ancestors`, nosniff, Referrer-Policy ; HSTS non vérifié en prod) | Code · sécurité | Moyenne | non renseigné | Non | U |
| COD-C11 | Image exécutée en root avec npm, apk, wget et les dépendances du front ; 3 CVE critiques (Scout) ; image de base jamais tirée | Code · sécurité | Moyenne | non renseigné | Non | U |
| COD-C12 · MAT-§5 | `GET /api/library` balaye les étiquettes de tous les comptes (index `category_id` manquant), à chaque ouverture de deck | Code · scalabilité | Moyenne | non renseigné | Non | U |
| COD-C15 | `lib/statsViews.ts` absent de `__ENGINE_VERSION__` : des aperçus périmés passeraient pour frais | Code · qualité | Moyenne | non renseigné | Non | U |
| PAR-07 · VIS-15 (`title=`) | Explications réservées au survol : « Comparer » désactivé sans motif au doigt, valeurs fines des matrices, hints des profils (106 attributs) | Parcours · visuel | Moyenne | non renseigné | Non | U |
| PAR-05 | Aucun glossaire ; « starter » sans bulle, « brick » expliqué nulle part | Parcours | Moyenne | non renseigné | Non | U |
| PAR-09 | Persistance à deux vitesses (deck vs compte) signalée seulement dans « Combos & catégories » | Parcours | Moyenne | non renseigné | Non | U |
| VIS-06 (hors légal et compte) | Page de connexion muette : ni promesse, ni aperçu, ni prix ; bouton Discord plus fort que l'action primaire | Visuel | Moyenne* | non renseigné | Non | U |
| VIS-11 · VIS-12 (légende, « · ») · VIS-10 (badges) · VIS-07 (grille) | Hiérarchie : statistique principale à 12 px, résultat de requête à 20 px ; badges cachant le nom ; « · » et Δ sans légende lisible ; accueil sans tri | Visuel | Moyenne* | non renseigné | Non | U |
| VIS-15 (`lang`, icône) | `lang="en"` sur une interface française ; aucun favicon, `theme-color`, manifest | Visuel | Faible* | non renseigné | Non | U |
| PAR-10 · VIS-08 | « Créer un deck vide » en lien fantôme ; `<input type=file>` natifs ; libellé en capitales | Parcours · visuel | Faible | non renseigné | Non | U |
| COD-C16 · MAT-§6 | 4 vulnérabilités npm en prod (fastify, fast-uri, uuid), non atteignables ; le deviennent avec des schémas de route | Code | Faible | non renseigné | Non | U |
| COD-C20 | Base de dev publiée sur toutes les interfaces avec `ygo/ygo` ; API de dev sur `0.0.0.0` | Code | Faible | non renseigné | Non | U |
| PER-O7 · COD-C14 · PER-M1 · PER-M2 · PER-Q2 | Moteur sans borne de coût : 40 starters à 1 copie = 50 s ; deck « tout annoté » = 14 s par clic ; aperçus recalculés en série après chaque déploiement du moteur | Permissions · code | Moyenne (Haute dès qu'un deck est partagé) | non renseigné | Non | T |
| COD-C13 | Construction sur le VPS de prod depuis `main`, coupure ≈ 21 s + 10 s, retour arrière par reconstruction, aucune image versionnée | Code · exploitation | Moyenne | non renseigné | Non | T |
| COD-C9 | `fingerprint.sql` échoue au-delà de 1 Go de texte par table (≈ 9 300 comptes) et bloque `deploy.sh` | Code · exploitation | Moyenne | non renseigné | Non | T |
| PAR-08 · PER-X3 | 13 clics pour comparer deux versions ; aucun historique de deck | Parcours | Moyenne | non renseigné | Non | T |
| VIS-13 | Plans de side à 360 : 48 vignettes avant le plan ; marqueurs « sort / entre » à 10 px | Visuel | Moyenne* | non renseigné | Non | T |
| VIS-15 (focus, dialogues) | Focus clavier invisible, aucun `role="dialog"`, Échap incohérent, `h-screen` sans `dvh`, champs < 16 px | Visuel | Moyenne* | non renseigné | Non | T |
| PER-O8 · PER-K1 · PER-K2 | Aperçus et chiffres de plan stockés falsifiables (`engineVersion: "n-importe-quoi"` accepté) | Permissions | Faible | non renseigné | Non | T |
| PER-O14 | Requête « simple » `text/plain` acceptée sur `duplicate` (cookie Lax, même site que goldfish) | Permissions | Faible | non renseigné | Non | T |
| COD-C17 | Recherche à 2 caractères en balayage complet (7,5 cœurs à 196 req/s) ; jokers `%` et `_` non échappés | Code | Faible | non renseigné | Non | T |
| COD-C21 (store, prérequis, types) | Dette : store de 819 lignes, ancienne représentation des prérequis gardée pour les tests, types d'API recopiés | Code | Faible | non renseigné | Non | T |
| PAR-12 | « Chargement… » sans progression au premier chargement (< 1 s en local) | Parcours | Faible | non renseigné | Non | Aucun (§6) |
| VIS-14 | Comparateur : bandeaux avant tout contenu quand les decks sont identiques | Visuel | Faible* | non renseigné | Non | Aucun (§6) |
| VIS-18 | Tablette 768 : panneau de stats replié malgré la place | Visuel | Faible* | non renseigné | Non | Aucun (§6) |
| VIS-19 | Mur de mains : deux tiers vides à 1440, pastille de note dominante | Visuel | Faible* | non renseigné | Non | Aucun (§6) |
| VIS-20 (direction B) | Thème clair « papier » | Visuel | Faible* | non renseigné | Non | Aucun (§6) |
| COD-C21 (majeures) · MAT-§6 (dev) | 15 dépendances à une majeure de retard ; CVE des outils de dev (vitest, vite, esbuild, postcss) | Code | Faible | non renseigné | Non | Aucun (§6) |
| DON-A2 | Pré-téléchargement complet des images (≈ 2 Go, 29 000 requêtes) | Données | Faible | 1 j | Non | Aucun (§6) |
| DON-A5 | Mode hybride : images rechargées à la demande côté client | Données | Faible | A4 + 0,5 j | Non | Aucun (§6) |
| MAT-§5 (index secondaires) | `deck_cards`, `deck_starters` sans index hors clé primaire | Code | Faible | non renseigné | Non | Aucun (§6) |
| PER-X8 | Équipes en écriture partagée | Permissions | Faible | non renseigné | Non | Aucun (§6) |

## 4. Trois chantiers séquencés

### 4.1 Avant toute mise en vente (V)

**Objectif** : que personne ne paie pour un produit qu'un inconnu peut geler, dont les visuels peuvent disparaître du jour au lendemain, et qui ne sait ni encaisser ni honorer un droit sur son compte.

| Verrou | IDs |
|---|---|
| 1 Visuels et CDN | DON-B2, DON-A3..A7, DON-P0, DON-B1, DON-A1, PER-O6, PER-G4, PER-D20 |
| 2 Mécanisme de vente | PAR-01, PER-O12, PER-A2, PER-Q3, COD-C18, PER-O4, PER-A7, PER-H1, PER-§4.1–4.4, PER-Q4, DON-§5.4 |
| 3 Obligations envers le consommateur | DON-B4, DON-A8, DON-B6, DON-B5, PAR-02, PER-A6, VIS-06 (liens légaux, mot de passe) |
| 4 Un inconnu casse tout | COD-C1, PER-O1, PER-G2, COD-C2, PER-O2, PER-O3, PER-D6, PER-Q1, COD-C3, COD-C8 |
| 5 Exploitation aveugle | COD-C4, COD-C5, DON-R1, DON-P2a |
| Hygiène P0 non bloquante | PER-O10, PAR-11, PER-D4, PER-O5, PER-B2, PER-B5, VIS-05 |

**Effort cumulé** : 7,5 à 10 j chiffrés par le volet 03 (A1 1 à 1,5 ; A8 0,5 ; intégration des textes 0,5 ; droits 2 à 3 ; réinitialisation et vérification 2 à 3 ; journaux 0,5 ; `keep/` et archives 0,5), plus la stratégie des visuels (0,5 j ou 9 à 13 j selon la voie), plus **13 éléments non chiffrés** dont le verrou 2 tout entier, qui est à lui seul le plus gros morceau. Dit franchement : à un développeur solo, ce chantier prend des semaines, et le verrou 2 en est la majeure partie.

**Condition de sortie** (preuves reprises des volets) :
- `/%61pi/cards/search` → 401 en test d'intégration et à travers Caddy ; inscription avec 64 000 « @ » → 400 en moins de 50 ms, `/api/health` inchangé.
- Scénario `audit05-session-switch` rejoué : 0 tuile du compte A visible pour B.
- Sonde Q2 rejouée : `/api/auth/me` d'un autre compte reste sous 100 ms pendant 12 écritures de 163 Kio ; P7a, Q1, Q4 → 400 ou 413 immédiats.
- `docker stop app` en moins de 2 s, code 0 ; redémarrage de `db` sans arrêt de l'API.
- Alerte reçue quand l'app est arrêtée ; archive listée chez un second hébergeur et `restore.sh --check-only` verte depuis cette copie.
- `externalRequests` du parcours navigateur (volet 03 §1.3) : 0 requête vers `images.ygoprodeck.com` ; décision écrite dans DECISIONS.md sur la voie Konami (demande envoyée, ou retrait engagé).
- Un compte peut supprimer, exporter et rectifier ses données depuis l'interface ; pages légales liées depuis la connexion et le menu du compte ; OVH ou Azure tranché par écrit.
- Un compte gratuit se heurte à ses quotas (P6 rejouée → 429 ou 403 au-delà du seuil) ; un paiement de test aboutit et écrit `plan` ; le code d'invitation épuisé est refusé (P1 rejouée) ou l'inscription passe par un email vérifié.
- Aucune réponse de l'API ne contient un `code` SQL (Q9 rejouée) ; aucune chaîne « § » visible dans l'interface.

### 4.2 Avant les 100 premiers utilisateurs (U)

**Objectif** : que le produit survive à ses premiers inconnus et à leurs premières demandes de support sans que chaque modification risque d'afficher un chiffre faux ou de rouvrir l'API, et que l'écran soit lisible par quelqu'un qui n'est pas son auteur.

| Bloc | IDs |
|---|---|
| Gardes de code | COD-C7, COD-C6, COD-C15, COD-C16 |
| Durcissement serveur | COD-C10, COD-C11, COD-C12, COD-C20, PER-O11, PER-O15, PER-D5, D9, D12, D14, D16, PER-B1, PER-B5, PER-O9, PER-A3, COD-C19, PER-O13, PER-A5, PER-H2, DON-R2 |
| Catalogue et RGPD documentaire | DON-B3, DON-A9, DON-K1, K2, K4, DON-P2b, DON-R3 |
| Lisibilité | VIS-01, VIS-02, VIS-04, VIS-17, VIS-20, VIS-03, VIS-09, PAR-06, VIS-11, VIS-12, VIS-10, VIS-07, VIS-15 (`lang`, icône) |
| Prise en main | PAR-03, PAR-04, VIS-16, PAR-05, PAR-07, PAR-09, PAR-10, VIS-08, VIS-06 (page d'atterrissage) |

**Effort cumulé** : 2,75 à 3,25 j chiffrés par le volet 03 (A9 + cron + version 2 à 2,5 ; clé 0,25 ; sessions 0,5), plus **22 éléments non chiffrés**, dont la direction A (remappage de 186 classes de couleur et 159 tailles) est le plus lourd.

**Condition de sortie** :
- CI verte sur `main` protégée : typecheck, `test-quiet`, suite d'intégration sur PostgreSQL jetable, `auth.integration.ts` sur l'app réelle, test différentiel du constructeur à graine fixe, `npm audit --omit=dev --audit-level=high`.
- En-têtes CSP, `frame-ancestors`, nosniff, Referrer-Policy et HSTS présents en prod (`curl -sI`) et e2e verte (worker, PDF, styles).
- `docker run … id` → `node`, pas `root` ; `deploy.sh` tire l'image de base.
- `explain` de `GET /api/library` sans `Seq Scan` sur `card_categories`.
- Cron `migrate` + simulation `prune` journalisé ; version du catalogue visible dans l'interface ; aucune clé Supabase dans le dépôt.
- Script `SCAN` du volet 01 rejoué : 0 style de texte visible sous 4,5:1 sur l'éditeur à 1440 et 360, aucune taille sous 11 px ; « Plans de side » atteignable à 360 sans balayage aveugle.
- Un deck sans starter affiche la cause du 0 % ; « brick » et « starter » ont une définition accessible au toucher.

### 4.3 Plus tard (T)

**Objectif** : préparer la croissance (au-delà de ≈ 200 utilisateurs actifs ou ≈ 1 000 comptes) et le partage de decks, sans y consacrer un jour tant que ni l'un ni l'autre n'est là.

**IDs** : PER-O7, COD-C14, PER-M1, PER-M2, PER-Q2, COD-C13, COD-C9, PAR-08, PER-X3, VIS-13, VIS-15 (focus, dialogues), PER-O8, PER-K1, PER-K2, PER-O14, COD-C17, COD-C21 (store, prérequis, types).

**Effort cumulé** : 17 éléments, aucun chiffré par les volets.

**Condition de sortie** : ce chantier n'a pas de fin en soi ; chaque élément s'ouvre sur un déclencheur mesurable : `pg_stat_activity` ou p95 au-delà de 2 s en usage réel (C13, multi-instance), 1 000 comptes (C9), première fonction de partage ou de démo (O7, O8, O14), première plainte sur un deck « tout annoté » (C14).

## 5. Une semaine

Cinq jours ouvrés, en série, sans mise en vente au bout. Ordre : d'abord ce qui est localisé, mesuré et déjà prototypé (verrou 4), puis le minimum technique du verrou 1, puis l'exploitation, puis le début du verrou 3. Aucun déploiement n'est compté : il se fait depuis le VPS, sur demande explicite, avec sa propre coupure.

| Jour | IDs traités | Ce qui est fait | Jusqu'où |
|---|---|---|---|
| Lundi | COD-C1, PER-O1, PER-G2, PER-O10, PAR-11, PER-D4, PER-O5, COD-C7 (amorce) | Longueur d'email ≤ 254 avant la regex et `bodyLimit` sur les routes d'authentification ; garde décidée sur la route résolue avec `config: { public: true }` et `requireUser` dans `cards.ts` ; `setErrorHandler` générique, `limit` entier 1..100, DELETE → 404 si rien supprimé ; `id` client ignoré pour étiquettes et plafonds ; fabrique `buildApp()` et première suite `auth.integration.ts` (401 sans cookie, `/%61pi` → 401, 64 000 « @ » → 400 rapide, 429 au 11ᵉ login) | Sondes P2, P4, Q7, Q9 et `redos-probe` rejouées vertes |
| Mardi | PER-O2, PER-O3, PER-D6, PER-Q1, COD-C3, COD-C8, COD-C2 | Écriture en lot portée depuis la variante du volet 05 (`writeConfiguration`, `mergeLibrary`) ; bornes de représentation dans `parseConfiguration` et `parseArchive` selon la proposition Q1 (3 × maxima du jeu, listes bornées aux cartes présentes) ; `bodyLimit` par route ; `statement_timeout`, `idle_in_transaction_session_timeout`, `max` du pool, `requestTimeout` ; `pool.on('error')` et gestionnaire SIGTERM ; côté client, `onUnauthorized` purge les brouillons et recharge, `loadDeck` réinitialise le store en échec | Suite de persistance 14 / 14, sondes Q1, Q2, Q4, P7a rejouées, `session-switch` à 0 tuile ; e2e `setup,guards` verte |
| Mercredi | DON-B1, DON-A1, PER-O6, PER-G4, PER-D20 | Relais avec cache disque persistant (`cards_small` et `cards_cropped`), volume dans le compose de prod, `imageSmall` / `imageCropped` pointés sur le relais, PDF inchangé ; e2e `sidesheet` et `guards` rejouées | 0 requête navigateur vers `images.ygoprodeck.com` sur le parcours du volet 03 §1.3 ; un appel amont par image, jamais plus |
| Jeudi | DON-A8, COD-C4, DON-B5, COD-C5, DON-R1, DON-P2a, AGENTS.md:60 | Attribution et non-affiliation (connexion, en-tête, en-tête du PDF) ; `logging` avec rotation sur `db` et `app` ; sonde externe sur `/api/health` avec alerte hors VPS ; alerte sur « sauvegarde NON vérifiée » ; `rclone copy` chiffré des archives vers un second hébergeur en fin de `backup.sh` ; rétention de `keep/` ; archives locales chiffrées ou supprimées ; correction de l'affirmation d'AGENTS.md | `test-backup-restore.sh` vert ; alerte reçue sur arrêt volontaire de l'app ; archive visible chez le second hébergeur |
| Vendredi | DON-B4 (art. 15–17), PAR-02, PER-A6 ; décisions DON-B6, DON-P0, PER-Q3, PER-Q4 | `DELETE /api/auth/account` (mot de passe redemandé, `destroySession`), `GET /api/auth/account/export`, changement de mot de passe avec vérification de l'ancien, entrées dans `AccountMenu` ; en fin de journée, quatre décisions écrites dans DECISIONS.md : OVH ou Azure, voie Konami (demandes A7 envoyées à YGOPRODeck et Konami, ou retrait engagé), invitation comptée ou inscription ouverte, contenu des offres | Suppression d'un compte de test vérifiée en cascade ; export relu ; demandes A7 parties (0 j de code, délai inconnu) |

**Ce que cette semaine ne règle pas** :
- Le verrou 2 en entier : rôles, offres, quotas, paiement, inscription ouverte avec email vérifié (migration 005, `entitlements.ts`, débits par compte, webhook). Rien n'est vendable vendredi soir.
- Le verrou 3 pour moitié : réinitialisation de mot de passe et vérification d'email (prestataire d'emails, 2 à 3 j), textes légaux (rédaction par un tiers), registre et contrats.
- Le verrou 1 sur le fond : A1 arrête le hotlink, il ne donne aucun droit sur les visuels ; la réponse de Konami ou la voie « sans visuels » (9 à 13 j) restent devant.
- Toute la lisibilité (direction A, mobile, deck vide, glossaire), le catalogue (A9), la CI complète et le test différentiel (C6, C7 au-delà de l'amorce), les en-têtes de sécurité, l'image non root.
- Le déploiement lui-même et sa vérification en prod (O1 à travers le vrai Caddy, HSTS, rotation du démon Docker).

## 6. Ce que je peux ignorer

| ID | Constat | Pourquoi il est défendable de ne jamais le traiter |
|---|---|---|
| VIS-20 (direction B) | Thème clair « papier » | Le volet 01 le déconseille lui-même : il casse les accents en teinte 300, le bouton primaire, les 42 fonds translucides et les cartes de chaleur ; le clair existe déjà là où il sert (impression et PDF, 0 échec de contraste) |
| PAR-12 | « Chargement… » sans progression | Le volet 02 le classe non bloquant, latence mesurée sous 1 s |
| VIS-14 | Bandeaux du comparateur avant le contenu | Ne survient qu'avec deux decks identiques, cas sans valeur pour l'utilisateur ; la capture a d'ailleurs été remplacée par le volet |
| VIS-18 | Tablette 768 : panneau replié malgré la place | Un seul point de rupture pour un public dont l'existence n'est établie par aucun volet ; le mobile (360) et le bureau (1440) sont les deux cibles mesurées |
| VIS-19 | Mur de mains : deux tiers vides à 1440, pastille dominante | Cosmétique ; la version compacte à 360 est jugée bonne par le volet 01 |
| COD-C21 (majeures) · MAT-§6 (dev) | 15 majeures en retard ; CVE de vitest, vite, esbuild, postcss | Outils de développement seulement (volet 05 : non atteignables en prod) ; monter React, Tailwind, Vite et Vitest d'une majeure sans linter ni tests de composants est un risque sans gain visible ; à faire le jour où une fonction l'exige, pas avant |
| DON-A2 | Pré-téléchargement complet des images (≈ 2 Go, 29 000 requêtes) | A1 en cache paresseux satisfait déjà « tirer une fois » ; A2 n'apporte que l'absence de latence au premier affichage, au prix de 1 j et d'un stock de 2 Go, et devient sans objet si la voie « sans visuels » est choisie |
| DON-A5 | Mode hybride, images à la demande côté client | Le volet 03 note que c'est le choix de Dueling Network en 2016, avec la perte d'activité qui a suivi, et que le hotlink revient pour qui l'active |
| MAT-§5 (index secondaires) | `deck_cards`, `deck_starters` sans index hors clé primaire | Le plan [D] du volet 05 montre une semi-jointure sur clé primaire en 3,2 ms : aucun index nécessaire |
| PER-X8 | Équipes en écriture partagée | Hors du modèle « un deck, un propriétaire, autrui → 404 » ; option produit jamais demandée, à ne pas confondre avec le partage en lecture |

## 7. Contradictions entre volets

### 7.1 Faits contredits

| Fait | Position A | Position B | Ce qui tranche |
|---|---|---|---|
| Nombre de tests de la suite `purge.integration.ts` | MAT-§7 : 14 cas | COD-§5.1 : 11, en citant AGENTS.md | Compter les `test(` du fichier ou rejouer la suite sur la base jetable 55433 ; sans effet sur la priorisation |
| Cause de l'échec du lancement local pendant la collecte | MAT-§9 et §11 : « incompatibilité transitoire auth Postgres », « infrastructure de dev complexe » | PAR « Environnement de test » : le port 5433 était occupé par le conteneur d'un autre projet (`siteclients-tests-db`) et la base de dev locale porte un schéma incohérent (`relevance` NOT NULL sans défaut), artefact local jamais rejoué avec 003 | `docker ps` sur 5433 et la requête du volet 02 sur `nonengine_categories` ; sans effet sur la priorisation, mais la base de dev est à rejouer avant tout travail local |

### 7.2 Divergences d'appréciation (aucun fait contredit)

| Sujet | Volet | Volet | Arbitrage de la synthèse et élément qui tranche |
|---|---|---|---|
| Gravité du code d'invitation | PAR-01 : Critique (bloque 100 % des inscriptions) | PER-O12 : Moyenne (porte de sécurité) | Critique, parce que l'angle est la vente (verrou 2) ; PER-Q3 (bêta sur invitation ou ouverture) décide de la forme du correctif |
| Correctif de l'inscription | PAR-01 : ouvrir email + mot de passe sans code pour le gratuit | PER-Q3 : invitation à usage compté pour une bêta payante, puis email vérifié | Décision commerciale, à écrire vendredi (§5) ; les deux voies exigent l'email vérifié (DON-B4) |
| Gravité des erreurs internes renvoyées | PAR-11 : Élevée | PER-O10 : Moyenne | Haute, non bloquante, dans V parce que le correctif partage `index.ts` avec O1 |
| Cibles tactiles | PAR persona 3 : « Starter » 77,6 × 26 px conforme (≥ 24 px, minimum secondaire de la charte) | VIS-03 : 45 % des cibles < 32 px, « pas vendable » | Fixer un seul seuil produit dans `docs/design-system.md` (24 px de la charte ou 32 px du volet 01) avant la direction A |
| Isolation entre comptes | PER-§0.2 : « solide » (sonde P3) | COD-C2 : fuite prouvée | Les deux sont vrais : API étanche, navigateur non ; C2 reste dans le verrou 4 |
| Journaux de requêtes | DON-B5 : rotation **ou** `disableRequestLogging: true` | COD-C4 : garder des journaux avec `reqId` et compte, en rotation | Rotation (05), parce qu'un service payant sans journal d'erreurs ne se dépanne pas ; durée à fixer avec la recommandation CNIL citée par 03 |
| Catalogue (DON-B3) | 03 : « empêche de vendre » | Synthèse : avant les 100 premiers utilisateurs | Arbitrage §1.4 ; à revoir si une sortie de set tombe pendant le chantier V |

### 7.3 Contradictions entre les volets et le dépôt (volets concordants)

| Affirmation du dépôt | Contredite par | À corriger |
|---|---|---|
| AGENTS.md:60 « L'app ne journalise pas les requêtes » | DON-B5 (preuve d'exécution), COD-C4 (412 octets par requête) | AGENTS.md, jeudi de §5 |
| DECISIONS.md:1214-1216 et server/AGENTS.md:9 « Public : `/api/health` et `/api/auth/*` uniquement » | PER-O1 (`/%61pi/…`) | Le code, lundi de §5 ; la règle reste vraie une fois la garde décidée sur la route résolue |
| `docs/design-system.md` §2.1 « ne jamais faire porter une information par ink-500 ou ink-600 » | VIS-01 : 87 + 33 emplois en texte, en grande majorité pour de l'information | Le code (direction A), pas la charte |
| `engine/types.ts:92` « deckSize 40..60 (§D) » | PER-O7 : commentaire non appliqué, un main de 1 000 cartes est calculé | Décision PER-Q1, mardi de §5 |

## 8. Non vérifié

Consolidation des sections « Non vérifié », « Non collecté » et « écarté » des six volets, dédoublonnée.

| Trou | Volets | Impact sur la fiabilité de la priorisation |
|---|---|---|
| **La prod n'a jamais été interrogée** : O1 à travers le Caddy réel et sa version ; en-têtes HTTPS réels (HSTS) ; Caddyfile réel de goldfish ; rotation des journaux dans le démon Docker du VPS ; copies hors VPS faites hors dépôt ; version du catalogue en prod ; état de la base et journaux de prod ; Referer réellement transmis au CDN | 00 §11, 03 §7 (8, 9, 12), 04 §8 (1), 05 §7 (1, 12, 13) | Trois vérifications de cinq minutes, données par les volets (`curl` sur `/%61pi/cards/search`, `curl -sI` des en-têtes, lecture de `daemon.json` et du cron du VPS), peuvent faire sortir O1 de « critique » (la garde resterait à corriger en défense), retirer le volet disque de C4 et sortir C5 du verrou 5. Le rang des verrous 1 à 3 ne dépend d'aucune d'elles |
| **Capacité du VPS et environnement de mesure** : cœurs, mémoire, disque inconnus ; durées mesurées sous Docker Desktop avec redirection de port ; modèle d'usage hypothétique (une requête / 4 s, un enregistrement / min) ; profil de données synthétique ; gel à 1 Mio extrapolé de 256 000 ; moteur mesuré sous Node, pas dans un navigateur ni sur mobile ; stock d'images estimé sur un échantillon par format | 03 §7 (7), 04 §8 (2, 3, 5), 05 §7 (2, 3, 4, 5, 8) | Les seuils absolus (≈ 300 actifs, ≈ 9 300 comptes, 12 min, 2 Go) sont incertains dans les deux sens ; les mécanismes (coût en n², une instruction SQL par ligne, pool de 10, un seul processus) ne le sont pas. Le rang des verrous 4 et 5 tient ; seuls des éléments de T (C9, C13, multi-instance) pourraient se rapprocher |
| **Juridique** : licence, tolérance ou contentieux entre Konami et les outils monétisés ; texte intégral de la page Konami Europe (403) ; la phrase « however you wish » attribuée à YGOPRODeck, absente du guide et rejetée ; filtrage par Referer ou blocage déjà effectif ; API officielle Konami ; limite de débit propre au CDN ; durées légales et bases légales ; hébergement Azure ; tout avis de droit | 03 §7 (1–6, 13, 15), 04 §8 (11) | L'ampleur du verrou 1 va de « une attribution suffit » (0,5 j) à « retirer tous les visuels » (9 à 13 j). Son rang ne bouge pas : la décision est due dans tous les cas, et un juriste doit valider les bases légales du verrou 3 avant les textes |
| **Parcours non exercés** : Discord OAuth (aucune application configurée) ; inscriptions depuis plusieurs IP ; O14 dans un vrai navigateur ; option `hook` de `@fastify/rate-limit` ; suppression en cascade d'un compte (déduite des FK) ; brouillons IndexedDB après un 401 ; mutants survivants face à l'e2e ; suites `purge`, `test-migration-sequence`, `rehearsal` et e2e non rejouées ; écriture en lot validée par la seule suite de persistance ; atteignabilité des CVE OpenSSL ; robustesse du code d'invitation de prod ; contenu des exports Excel ; offre Supabase de cryoclass ; réseau dégradé pour les images | 02 « Non vérifié », 03 §7 (10, 11, 14), 04 §8 (4, 6, 7, 8, 10), 05 §7 (6, 7, 9, 10, 11, 14, 15, 16) | Faible sur le classement. Deux conséquences pratiques : Discord est un angle mort complet d'un chemin d'inscription (verrou 2) ; l'écriture en lot doit être revalidée par `purge`, `prune-stale-cards` et l'e2e avant d'être portée (mardi de §5) |
| **Rendu et accessibilité non mesurés** : macOS, iOS, Android (polices, barres d'outils, zoom sur champ < 16 px) ; lecteurs d'écran et clavier ; daltonisme sur la carte de chaleur ; impression physique et PDF généré non ouvert ; registre visuel des concurrents ; latence perçue | 01 §9 | La direction A repose sur Windows / Chrome ; iOS et Android peuvent **ajouter** des défauts mobiles (zoom, `dvh`), pas en retirer. L'argument « le sombre est le registre attendu » est une hypothèse produit |
| **Quotas et questions ouvertes** : §4.3 sans donnée de marché ni d'usage ; Q1 (borne de représentation), Q2 (seuil de coût), Q3 (invitation ou ouverture), Q4 (contenu des offres), Q5 (admin et decks), Q6 (PDF avant le cache), Q7 (nom affiché public) | 04 §7, §8 (9) | Le verrou 2 ne peut pas être conçu sans Q1, Q3 et Q4 : la semaine de §5 les fait trancher vendredi ; Q2, Q5, Q6, Q7 attendent T ou les axes d'extension |
| **Levés par un autre volet** : captures (00 → 01, 02, 03) ; couverture des tests (00 → 05) ; `db.ts`, `env.ts` non lus (00 → 04, 05) ; latence des endpoints (00 → 05 §3) ; limite de débit derrière un réseau partagé (02 hypothèse → 05 C19 constat) ; erreur 500 à l'inscription sur la base de dev (02 : artefact local, infirmé sur base propre) | 00 §11, 02 « Non vérifié » | Aucun |
