import { config } from 'dotenv';

// Le .env du projet est UNIQUE, à la racine du repo. Or `npm run dev -w server`
// exécute avec cwd = server/, où `import 'dotenv/config'` ne trouve rien : jusqu'à
// l'itération 8 le serveur ne tournait que sur ses valeurs par défaut en dur.
// On charge donc le cwd (cas lancement depuis la racine) PUIS le .env racine par
// chemin explicite — dotenv n'écrase jamais une variable déjà définie, et ignore
// silencieusement un fichier absent. Deux profondeurs : depuis src/ (tsx) le
// .env racine est à ../../, depuis dist/src/ (build, rootDir=".") à ../../../.
// En conteneur, aucun .env : tout vient de l'environnement (docker compose).
config();
config({ path: new URL('../../.env', import.meta.url) });
config({ path: new URL('../../../.env', import.meta.url) });
