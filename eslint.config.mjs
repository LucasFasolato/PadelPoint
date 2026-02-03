// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs', 'dist/**', 'node_modules/**'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,

  // Base TS/Node config
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      // Change 'commonjs' to 'module' because you are using .mjs and NestJS 11
      sourceType: 'module', 
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Global rules (para todo el repo)
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',

      // Mantengo warnings (útiles) en general
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Prettier
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },

  {
    files: ['**/*.dto.ts', "**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/require-await": "off"
    },
  },

  // ✅ Entities: decorators de TypeORM también generan ruido
  {
    files: ['**/*.entity.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // ✅ Services: repos/ORM + return types a veces terminan como unknown para el linter
  {
    files: ['**/*.service.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
