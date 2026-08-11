# YGO — Calculateur de probabilités & sampler de mains

Importer une decklist, **annoter** les cartes (starters, paires de combo, non-engine,
HOPT), et obtenir en temps réel des **probabilités exactes** de main d'ouverture + un
**mur de mains** filtrable. Voir [`reutiliser-la-bdd.md`](reutiliser-la-bdd.md) pour la
source de données et le document de spécification complet pour le modèle.

Le cœur (moteur exact) est **énumération par composition**, pas Monte-Carlo ; le nombre
de starts d'une main est un **couplage maximum**, pas un comptage de combos.

## Stack

- **Postgres 17** (Docker, propre au projet) — catalogue de cartes migré depuis Supabase.
- **Fastify** (Node + TS) — catalogue, decks, bibliothèque d'annotations.
- **Vite + React + TS + Tailwind + Zustand** — UI dense, thème sombre.
- **Web Worker** — l'énumération ne fige jamais l'UI.

## Démarrage

Prérequis : Node ≥ 20, Docker, npm.

```bash
npm install                 # installe server + web (workspaces)
cp .env.example .env        # puis choisir INVITE_CODES (codes d'invitation)

npm run db:up               # Postgres en Docker (port hôte 5433) + schéma (db/schema.sql)
npm run migrate             # copie la table `cards` de Supabase → Postgres local (~14 k cartes)

npm run dev                 # backend :8787 + front :5173 en parallèle
# ou séparément :
npm run dev:server
npm run dev:web
```

Ouvrir http://localhost:5173. Le front proxifie `/api` → `:8787`.

**Comptes (itération 8)** : l'app demande une connexion ; l'inscription exige un code
de `INVITE_CODES` (`.env`). Decks et bibliothèque (combos, catégories, flags) sont
propres à chaque compte — le partage passe par l'export/import JSON. Optionnel :
« Se connecter avec Discord » (renseigner `DISCORD_CLIENT_ID`/`SECRET` dans `.env`,
app à créer sur le portail développeur Discord avec la redirection
`http://localhost:5173/api/auth/discord/callback` ; bouton masqué sinon). Base créée
avant l'itération 8 :

```bash
npm run db:schema           # rejoue db/schema.sql (idempotent) sur la base en marche
npm run adopt -- toi@mail.com ton-mot-de-passe   # crée ton compte et lui rattache tout l'existant
```

Sans backend/DB, l'app reste utilisable : les annotations vivent en mémoire + dans
l'URL (`#s=…`, état compressé partageable), et les images sont dérivées de l'`id` via le
CDN YGOPRODeck. La persistance (bibliothèque, decks) nécessite le backend + un compte.

## Tests

```bash
npm test                    # Vitest : reproduit les valeurs de contrôle §C (moteur)
```

## Structure

```
db/schema.sql          schéma normatif (§A) + comptes/sessions (itération 8)
server/                Fastify + pg
  scripts/migrate-cards.ts   Supabase → Postgres local (§6.1)
  scripts/adopt-legacy.ts    migration base pré-comptes → un compte propriétaire
  src/auth/            scrypt, sessions (cookie httpOnly, token haché), comptes
  src/routes/          auth, cards, decks, library
web/src/
  engine/              moteur exact + tests §C  (binomial, matching, enumerate, evaluate, hand)
  worker/              wrapper Web Worker
  store/               Zustand + sélecteurs (modèle moteur, couleurs, échantillonnage)
  lib/auth.tsx         AuthProvider (session, login/logout, mode hors-ligne)
  components/          login, import, grille d'annotation, combos, stats, mode requête, mur de mains
```

Voir [`DECISIONS.md`](DECISIONS.md) pour les points tranchés en cours de route
(dont deux coquilles du tableau §C).
