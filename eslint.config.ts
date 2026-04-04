import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**'] },

  eslint.configs.recommended,

  // typescript-eslint: type-aware rules
  tseslint.configs.recommended,
  {
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },

  // import-x: named exports + import ordering
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    rules: {
      'import-x/no-default-export': 'error',
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },
  },

  // Relax rules for test and mock files
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'src/__mocks__/**/*.ts'],
    rules: {
      'no-console': 'off',
      'import-x/no-default-export': 'off',
    },
  },

  // Prettier: disable conflicting formatting rules — MUST BE LAST
  eslintConfigPrettier,
);
