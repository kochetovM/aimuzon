/**
 * ESLint configuration for React + TypeScript with human-friendly readability rules.
 * - Integrates React, React Hooks, TypeScript, a11y, and import rules.
 * - Favors clear spacing/indentation and warns on common pitfalls.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    project: false,
  },
  settings: {
    react: { version: 'detect' },
    'import/resolver': {
      node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
      typescript: {},
    },
  },
  plugins: ['react', 'react-hooks', '@typescript-eslint', 'jsx-a11y', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
  ],
  rules: {
    // General code quality
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'no-debugger': 'warn',

    // Spacing/formatting for readability
    // Use 2 spaces consistently (allowed by requirements)
    'indent': ['error', 2, { SwitchCase: 1 }],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'semi': ['error', 'always'],
    'eol-last': ['error', 'always'],
    'no-trailing-spaces': 'error',
    'max-len': ['error', { code: 120, tabWidth: 2, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
    'padding-line-between-statements': 'off',

    // Naming conventions
    '@typescript-eslint/naming-convention': [
      'error',
      { selector: 'default', format: ['camelCase'] },
      { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'] },
      { selector: 'function', format: ['camelCase', 'PascalCase'] },
      { selector: 'typeLike', format: ['PascalCase'] },
      { selector: 'objectLiteralProperty', format: null },
      { selector: 'objectLiteralMethod', format: null },
      { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE', 'camelCase'] },
    ],

    // TypeScript-specific
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'warn',
    '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true, allowTypedFunctionExpressions: true }],

    // React/JSX
    'react/react-in-jsx-scope': 'off',
    'react/jsx-boolean-value': ['warn', 'never'],
    'react/jsx-curly-spacing': ['warn', { when: 'never', children: true }],
    'react/jsx-tag-spacing': ['warn', { beforeSelfClosing: 'always' }],
    'react/self-closing-comp': 'warn',
    'react/jsx-pascal-case': 'error',

    // Hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'off',

    // Imports
    'import/order': 'off',
  },
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        'no-undef': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: { jest: true },
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
