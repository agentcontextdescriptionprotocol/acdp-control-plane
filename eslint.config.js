// Minimal flat ESLint config (eslint 9+) so `npm run lint` works.
// Scope: src/ + test/ TypeScript files. Catches the common issues
// our handwritten code keeps introducing (unused imports, mismatched
// async signatures) without imposing a heavyweight style guide.

const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'drizzle/**'],
  },
  {
    files: ['{src,test}/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Catch real bugs.
      '@typescript-eslint/no-floating-promises': 'off', // requires type info, expensive
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Style / consistency.
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
  // Spec files are looser — async describe wrappers, untyped jest mocks, etc.
  {
    files: ['{src,test}/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  // Tail: prettier compat (disables rules that would conflict with formatter).
  prettier,
];
