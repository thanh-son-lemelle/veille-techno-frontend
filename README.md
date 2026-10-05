# Veille Kanban — frontend

Vue 3, TypeScript, Vite, Vue Router, Pinia et Nuxt UI. Commandes à lancer à la racine du dépôt.

## Prérequis

- Git, Node.js `^22.18.0 || >=24.12.0` et npm. La CI et Docker utilisent Node 24.
- Docker Desktop avec conteneurs Linux pour le lancement Docker.
- Backend démarré séparément pour les appels API ; Compose démarre uniquement le frontend.

## Lancement local

```sh
git clone https://github.com/thanh-son-lemelle/veille-techno-frontend.git
cd veille-techno-frontend
npm ci
npm run dev
```

Ouvrir [localhost:5173](http://localhost:5173), ou l'adresse affichée par Vite. Arrêt : `Ctrl+C`. Relancer `npm ci` après une mise à jour des dépendances.

Pour modifier la configuration, copier `.env.example` vers `.env` une seule fois :

```sh
cp .env.example .env                 # Bash / Git Bash
```

```powershell
Copy-Item .env.example .env           # PowerShell
```

Copie facultative si les valeurs par défaut conviennent. Conserver tout `.env` déjà configuré.

### API

| Variable | Local | Docker Desktop |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | `/api` |
| `API_PROXY_TARGET` | `http://127.0.0.1:3000` | `http://host.docker.internal:3000` |

Le proxy Vite transmet `/api` au backend. Adapter sa cible puis redémarrer Vite si nécessaire. L'exemple Docker vise le backend sur l'hôte ; adapter l'adresse avec Docker Engine sans Docker Desktop.

Les variables `VITE_*` sont publiques : aucun secret. Le proxy fonctionne en développement et en preview, pas dans les fichiers statiques de `dist/`.

## Lancement Docker

Créer `.env.docker` une seule fois, sans écraser une configuration existante :

```sh
cp .env.docker.example .env.docker         # Bash / Git Bash
```

```powershell
Copy-Item .env.docker.example .env.docker   # PowerShell
```

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f frontend
docker compose down                       # Arrêt
```

Frontend : [localhost:5173](http://localhost:5173). Ne pas utiliser ce port simultanément en local. Les dépendances sont installées dans l'image.

`src`, `public` et `index.html` sont rechargés automatiquement. Reconstruire avec `docker compose up --build -d` après modification des dépendances, configurations, fichiers `e2e/` ou de `.env.docker`.

Pour les vérifications, préfixer les commandes npm/npx ci-dessous par `docker compose exec frontend` :

```sh
docker compose exec frontend npm run test:coverage
docker compose exec frontend npm run build
docker compose cp frontend:/app/coverage/. ./coverage
```

Lancer les E2E sur l'hôte avec Node et `npm ci` : l'image ne contient pas les navigateurs Playwright.

## Vérifications

| Commande | Usage |
| --- | --- |
| `npm run test:unit` | Tests unitaires en continu |
| `npm run test:unit -- --run` | Un seul passage |
| `npm run test:unit -- --run src/views/__tests__/LoginView.spec.ts` | Un fichier précis |
| `npm run test:coverage` | Suite unitaire et couverture |
| `npx --no-install oxlint . --deny-warnings` | Lint sans correction |
| `npx --no-install eslint . --max-warnings=0` | Lint sans correction |
| `npm run build` | Build dans `dist/` et vérification TypeScript |
| `npm run type-check` | Typage seul, après génération des déclarations par Vite |
| `npm run lint` | **Modifie les fichiers** : corrections Oxlint et ESLint |
| `npm run format` | **Modifie les fichiers** : formatage de `src/` |

Les tests unitaires simulent l'API. La couverture mesure les vues, `App.vue`, le composant `KanbanCards.vue`, les stores, le routeur et le client API, y compris les fichiers non importés par les tests. Seuil : **80 % par fichier** sur lignes, instructions, branches et fonctions.

Rapports : `coverage/index.html` et `coverage/coverage-summary.json`.

### Prévisualiser le build

```sh
npm run build
npm run preview
```

Ouvrir [localhost:4173](http://localhost:4173). Après une installation neuve, utiliser `npm run build` pour générer les déclarations Nuxt UI avant le contrôle des types.

## Tests navigateur

Installer les navigateurs après `npm ci`, puis après une mise à jour de Playwright :

```sh
npx --no-install playwright install
```

Sur Linux, utiliser `--with-deps` pour installer aussi les dépendances système ; des droits administrateur peuvent être nécessaires.

```sh
npm run test:e2e                                               # Tous les navigateurs
npm run test:e2e -- --project=chromium                          # Chromium
npm run test:e2e -- e2e/login.spec.ts --project=chromium         # Connexion
npm run test:e2e -- e2e/login.spec.ts --project=chromium --debug # Débogage
npx --no-install playwright show-report                       # Rapport HTML
```

Sans `CI`, les navigateurs sont visibles. Playwright démarre Vite sur le port 5173 ou réutilise le serveur présent, y compris Docker : vérifier qu'il sert le code attendu. Aucun build préalable requis.

L'API est simulée, sauf dans `e2e/api.spec.ts`, ignoré par défaut. Rapports : `playwright-report/` ; traces éventuelles : `test-results/`.

### Sans fenêtre, comme en CI

Faire `npm run build` et libérer le port 4173. Playwright gère ensuite le serveur preview.

```sh
CI=1 npm run test:e2e                         # Bash / Git Bash
```

```powershell
# PowerShell
$previousCI = $env:CI
try {
    $env:CI = '1'
    npm run test:e2e
} finally {
    $env:CI = $previousCI
}
```

### Avec le backend réel

Démarrer le backend et vérifier `API_PROXY_TARGET`. Ce test contrôle les erreurs HTTP 400 et 401 via le proxy.

```sh
# Bash / Git Bash
API_SMOKE_TEST=1 npm run test:e2e -- e2e/api.spec.ts --project=chromium
```

```powershell
# PowerShell
$previousApiSmokeTest = $env:API_SMOKE_TEST
try {
    $env:API_SMOKE_TEST = '1'
    npm run test:e2e -- e2e/api.spec.ts --project=chromium
} finally {
    $env:API_SMOKE_TEST = $previousApiSmokeTest
}
```

La CI suit cette séquence : installation, lint sans correction, couverture, build, installation des navigateurs et E2E. Voir `.github/workflows/ci.yml`.
