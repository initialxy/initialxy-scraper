import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        projectService: true,
        globals: {
          process: 'readonly',
          URL: 'readonly',
          __dirname: 'readonly',
          __filename: 'readonly',
          require: 'readonly',
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      'no-console': ['warn', { allow: ['debug', 'error'] }],
      'no-undef': 'off',
    },
  },
  prettier,
  {
    ignores: ['node_modules/', 'dist/'],
  },
];
