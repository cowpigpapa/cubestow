// 정적 검사(ESLint). 브라우저 스크립트는 모듈이 아니라 전역을 함께 쓰는 여러 파일이라 no-undef는 끈다.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'vendor/',
      'sample-results/',
      'test-results/',
      'playwright-report/',
      'outputs/',
      'research/',
      'engine/'
    ]
  },
  js.configs.recommended,
  {
    files: ['*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  {
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }]
    }
  },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } }
];
