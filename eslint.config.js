import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // core must stay UI-free so a headless front end can reuse it.
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react/*', 'react-*'], message: 'src/core must not depend on React.' },
          { group: ['@opentui/*'], message: 'src/core must not depend on OpenTUI.' },
          { group: ['**/tui', '**/tui/**', '**/main', '**/main.tsx'], message: 'src/core must not import from the TUI layer.' },
        ],
      }],
    },
  },
])
