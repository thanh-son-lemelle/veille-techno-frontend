import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((configEnv) =>
  mergeConfig(viteConfig(configEnv), {
    test: {
      environment: 'jsdom',
      coverage: {
        provider: 'v8',
        include: [
          'src/App.vue',
          'src/components/KanbanCards.vue',
          'src/views/**/*.vue',
          'src/stores/**/*.ts',
          'src/router/**/*.ts',
          'src/api/**/*.ts',
        ],
        exclude: ['src/**/__tests__/**', 'src/api/types.ts'],
        reporter: [['text', { skipFull: false }], 'html', 'json-summary'],
        thresholds: { perFile: true, statements: 80, branches: 80, functions: 80, lines: 80 },
      },
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
