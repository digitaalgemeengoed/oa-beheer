# Beheerportaal van de Office Assistent: één image met backend en frontend.
#   docker build -t oa/beheer .
# Draait als gewone gebruiker (node), zonder schrijfrechten op de code.

FROM node:22-alpine AS bouw
WORKDIR /bron
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=bouw /bron/node_modules ./node_modules
COPY --from=bouw /bron/backend/package.json ./backend/package.json
COPY --from=bouw /bron/backend/dist ./backend/dist
COPY --from=bouw /bron/backend/migraties ./backend/migraties
COPY --from=bouw /bron/frontend/dist ./frontend/dist
USER node
EXPOSE 4300
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null --header="Host: ${BEHEER_HOST}" http://127.0.0.1:4300/api/gezondheid || exit 1
CMD ["node", "backend/dist/index.js"]
