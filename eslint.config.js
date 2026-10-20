import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "supabase/functions/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
