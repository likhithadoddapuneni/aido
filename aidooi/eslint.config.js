import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Inject a Clock; domain code must be deterministic.' },
      ],
    },
  },
  // Only the shell may read the real clock.
  {
    files: [
      'apps/**/src/**/*.ts',
      'apps/**/test/**/*.ts',
      'apps/**/scripts/**/*.ts',
      // End-to-end harnesses start real processes and wait on real time.
      'apps/**/e2e/**/*.ts',
      'packages/db/**/*.ts',
      'packages/**/test/**/*.ts',
      // Web UI formats user-supplied instants and reads wall time at the edge; it holds no business rules.
      'packages/ui-web/**/*.{ts,tsx}',
      'scripts/**',
    ],
    rules: { 'no-restricted-globals': 'off' },
  },
  // Metro, Babel and Jest read their configuration as CommonJS.
  {
    files: ['**/babel.config.{js,cjs}', '**/metro.config.js', '**/jest.config.{js,cjs}'],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
);
