# veille-technique-frontend

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Run End-to-End Tests with [Playwright](https://playwright.dev)

```sh
# Install browsers for the first run
npx playwright install

# When testing on CI, must build the project first
npm run build

# Runs the end-to-end tests
npm run test:e2e
# Runs the tests only on Chromium
npm run test:e2e -- --project=chromium
# Runs the tests of a specific file
npm run test:e2e -- tests/example.spec.ts
# Runs the tests in debug mode
npm run test:e2e -- --debug
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

## Développement avec Docker

Ouvrir Docker Desktop avec les conteneurs Linux. Depuis le dossier du frontend, préparer la configuration une seule fois :

```sh
cp .env.docker.example .env.docker
```

Puis démarrer :

```sh
docker compose up --build -d
```

Ouvrir [http://localhost:5173](http://localhost:5173). Les modifications dans `src`, `public` et `index.html` sont prises en compte automatiquement.

Pour arrêter :

```sh
docker compose down
```

Le fichier `compose.yaml` gère le port et les sources partagées. Il charge `.env.docker`, qui contient les réglages locaux et pourra accueillir la configuration de connexion au backend. Ce fichier reste ignoré par Git ; son exemple est versionné. Les variables `VITE_*` sont publiques et ne doivent pas contenir de secrets.

Les dépendances sont installées dans l'image Docker et le rechargement automatique est activé par `CHOKIDAR_USEPOLLING=true`.

### Commandes utiles

```sh
# Voir les logs
docker compose logs -f frontend

# Voir l'état du frontend
docker compose ps

# Lancer les tests unitaires
docker compose exec frontend npm run test:unit -- --run

# Vérifier les types et le build de production
docker compose exec frontend npm run build

# Vérifier le code sans correction automatique
docker compose exec frontend npx --no-install oxlint . --deny-warnings
docker compose exec frontend npx --no-install eslint . --max-warnings=0
```

Après un changement de dépendances, de configuration ou de `.env.docker`, relancer `docker compose up --build -d`
