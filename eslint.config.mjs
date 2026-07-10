import nextPlugin from 'eslint-config-next';
import prettierConfig from 'eslint-config-prettier';

const eslintConfig = [
  ...nextPlugin,
  prettierConfig,
  { ignores: ['.next/**', 'node_modules/**', '.pnpm-store/**'] },
];

export default eslintConfig;
