import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import i18next from 'eslint-plugin-i18next';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: ['.next/**', 'dist/**', 'build/**', 'node_modules/**', '**/*.js', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    plugins: {
      i18next,
    },
    rules: {
      'i18next/no-literal-string': ['warn', {
        markupOnly: true,
        ignoreAttribute: ['className', 'style', 'href', 'src', 'alt', 'id', 'variant', 'size', 'role', 'aria-live', 'aria-label', 'value', 'type'],
      }],
    },
  },
];

export default eslintConfig;
