// eslint-config-next 16+ exporta flat config nativamente — NÃO usar FlatCompat aqui.
// FlatCompat re-processando um config já flat (react-hooks se auto-referencia) quebra o
// validador do ESLint 9.39 com "Converting circular structure to JSON" (bug conhecido,
// verificado em set/2026 — ver vercel/next.js#85244).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", "node_modules/**", "dist/**"],
  },
];

export default config;
