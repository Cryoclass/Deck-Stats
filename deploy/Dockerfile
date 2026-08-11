# Build multi-étages : front Vite + serveur tsc → runtime Node minimal.
# Node 22 : aligné sur le dev (et Maintenance LTS jusqu'à avril 2027).
FROM node:22-alpine AS build
WORKDIR /app
# Manifestes seuls d'abord : le npm ci est mis en cache tant qu'ils ne changent pas.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build
# Ne garder que les dépendances de production pour l'étage final.
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
# server/node_modules n'existe que si npm n'a pas pu hisser une dépendance
# (versions en conflit) — le glob [s] rend la copie optionnelle.
COPY --from=build /app/server/node_module[s] server/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# Le serveur sert le front (même origine) ; rootDir "." → l'entrée est dist/src/.
ENV PORT=8787 WEB_DIST=/app/web/dist
EXPOSE 8787
CMD ["node", "server/dist/src/index.js"]
