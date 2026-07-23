# Réutiliser la base pour un site en lecture seule

Petit topo pour un autre projet (site web simple) qui veut juste lire la base,
récupérer les **ids** des cartes et afficher leurs **images**. Rien de compliqué :
la base est un Supabase, exposé via une API REST publique.

---

## 1. Ce qu'il faut savoir en 30 secondes

- La base est un **Supabase** (Postgres + API REST auto-générée « PostgREST »).
- Deux infos suffisent pour s'y connecter, elles sont **publiques** (conçues pour être
  mises côté client) :
  - **URL** : `https://fczujhwaxkmspdgvuyyg.supabase.co`
  - **Clé anon / publishable** : `sb_publishable_VhrITzX99YP_j7u6GUpWsw_taHSczkR`
- Les **images ne sont PAS stockées dans Supabase**. La base ne contient que des
  **liens** vers le CDN d'images de YGOPRODeck (`images.ygoprodeck.com`). Le site n'a
  donc qu'à mettre ces URLs dans une balise `<img>`.

> ⚠️ Ne jamais mettre côté client la `CONNECTION_STRING` (Postgres direct) ni une
> éventuelle *service key*. Elles donnent un accès total. La clé **anon** ci-dessus est
> la seule à utiliser dans un navigateur : les règles de sécurité (RLS) limitent ce
> qu'elle peut lire.

---

## 2. Ce que la clé anon peut lire

| Table               | Accès anon | Contenu utile                                            |
|---------------------|:----------:|----------------------------------------------------------|
| `cards`             | ✅ lecture | **id + images**, nom, type, atk/def, description…        |
| `card_printings`    | ✅ lecture | éditions/sets d'une carte (set_code, rareté)             |
| `card_translations` | ✅ lecture | noms/descriptions traduits (fr, de, …)                   |
| `collection_items`  | ⛔ interdit | inventaire perso d'un utilisateur (privé, protégé)      |

Pour un site « images + ids », **seule `cards` est nécessaire**.

### La table `cards`

Colonnes qui t'intéressent :

| Colonne             | Type   | Exemple                                                        |
|---------------------|--------|---------------------------------------------------------------|
| `id`                | `int8` | `76908448` — c'est le **passcode** officiel de la carte        |
| `name`              | `text` | `Gem-Knight Crystal`                                           |
| `image_url`         | `text` | `https://images.ygoprodeck.com/images/cards_small/76908448.jpg` |
| `image_url_small`   | `text` | vignette (petit format)                                        |
| `image_url_cropped` | `text` | illustration seule (rognée, sans le cadre)                    |

> À savoir : l'`id` **est** le passcode YGOPRODeck. L'URL d'image suit toujours le
> schéma `https://images.ygoprodeck.com/images/cards/<id>.jpg` (grand format),
> `.../cards_small/<id>.jpg` (vignette) ou `.../cards_cropped/<id>.jpg` (artwork).
> Tu peux donc soit lire la colonne `image_url`, soit la reconstruire à partir de l'`id`.

---

## 3. Se connecter et lire — 2 options

### Option A — REST brut, sans aucune dépendance (le plus simple)

L'API REST répond en JSON. Il suffit d'un `fetch` avec la clé dans les en-têtes.

```js
const SUPABASE_URL = "https://fczujhwaxkmspdgvuyyg.supabase.co";
const ANON_KEY = "sb_publishable_VhrITzX99YP_j7u6GUpWsw_taHSczkR";

async function fetchCards() {
  const url =
    `${SUPABASE_URL}/rest/v1/cards` +
    `?select=id,name,image_url,image_url_small` +
    `&order=name.asc&limit=50`;

  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  return res.json(); // -> [{ id, name, image_url, image_url_small }, ...]
}
```

Quelques filtres PostgREST pratiques dans l'URL :

- Une carte précise : `?id=eq.76908448`
- Recherche par nom : `?name=ilike.*dragon*`
- Pagination : `?limit=50&offset=100`
- Choisir les colonnes : `?select=id,image_url`

### Option B — avec `supabase-js` (plus confortable si le site grossit)

```html
<script type="module">
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

  const supabase = createClient(
    "https://fczujhwaxkmspdgvuyyg.supabase.co",
    "sb_publishable_VhrITzX99YP_j7u6GUpWsw_taHSczkR"
  );

  const { data, error } = await supabase
    .from("cards")
    .select("id, name, image_url, image_url_small")
    .order("name")
    .limit(50);
</script>
```

Aucune authentification n'est nécessaire : la clé anon suffit pour lire `cards`.

---

## 4. Afficher les images

Les URLs pointent vers le CDN YGOPRODeck. **Mets-les directement dans une balise
`<img>`** — c'est tout.

```js
const img = document.createElement("img");
img.src = card.image_url;   // ou image_url_small / image_url_cropped
img.alt = card.name;
img.loading = "lazy";
document.body.appendChild(img);
```

> ⚠️ **Piège CORS (déjà rencontré sur ce projet).** N'essaie **pas** de charger
> l'image via `fetch()` / `XHR` (ex. pour la transformer en blob) : le CDN YGOPRODeck
> n'envoie pas les en-têtes CORS et ça échoue dans le navigateur. En revanche une
> balise `<img>` native n'est **pas** soumise au CORS pour du simple affichage → ça
> marche sans rien faire. Reste donc sur `<img src="...">`.

---

## 5. Exemple complet copiable (`index.html`)

Page autonome : liste les cartes et affiche leurs vignettes.

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Cartes</title>
    <style>
      .grid { display: grid; grid-template-columns: repeat(auto-fill, 120px); gap: 12px; }
      figure { margin: 0; text-align: center; font: 12px sans-serif; }
      img { width: 120px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="grid" id="grid"></div>

    <script type="module">
      const SUPABASE_URL = "https://fczujhwaxkmspdgvuyyg.supabase.co";
      const ANON_KEY = "sb_publishable_VhrITzX99YP_j7u6GUpWsw_taHSczkR";

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/cards` +
          `?select=id,name,image_url_small&order=name.asc&limit=60`,
        { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } }
      );
      const cards = await res.json();

      const grid = document.getElementById("grid");
      for (const card of cards) {
        grid.insertAdjacentHTML(
          "beforeend",
          `<figure>
             <img src="${card.image_url_small}" alt="${card.name}" loading="lazy" />
             <figcaption>#${card.id}</figcaption>
           </figure>`
        );
      }
    </script>
  </body>
</html>
```

Ouvre le fichier dans un navigateur → la grille de cartes s'affiche. C'est tout ce
qu'il faut pour un site en lecture seule.

---

## 6. Récap des règles

- ✅ Utiliser **URL + clé anon** côté client.
- ✅ Lire `cards` (et éventuellement `card_printings` / `card_translations`).
- ✅ Afficher les images avec une balise `<img>` (pas de fetch dessus).
- ⛔ Ne jamais exposer la connection string Postgres ni de service key.
- ⛔ Ne pas compter lire `collection_items` (données privées, bloquées).
