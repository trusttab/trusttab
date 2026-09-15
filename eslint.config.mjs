import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Modules that can sign or publish a manifest. The dashboard assistant must
 * never be able to reach them (see src/lib/publish-gate.ts). This rule blocks
 * direct imports; src/lib/assistant/capabilities.test.ts also checks the
 * transitive import graph.
 */
const PUBLISH_CAPABLE_MODULES = [
  "@/lib/manifest/signing",
  "@/lib/manifest/store",
  "@/lib/publish-gate",
  "@/app/api/sites/[id]/manifest/route",
  "@/app/api/sites/[id]/publish/confirm/route",
  "@/app/api/sites/[id]/verify/route",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The dashboard assistant and the AI Check estimates all call a model; none may reach signing or publishing.
    files: ["src/lib/assistant/**/*.ts", "src/lib/ai-text/**/*.ts", "src/lib/ai-image/**/*.ts", "src/lib/ai-check/**/*.ts", "src/app/api/ai-check/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                ...PUBLISH_CAPABLE_MODULES,
                "**/manifest/signing",
                "**/manifest/store",
                "**/publish-gate",
                "**/sites/*/manifest/**",
                "**/publish/**",
              ],
              message:
                "The dashboard assistant must never be able to sign or publish a manifest. Publishing is a human-only action (see src/lib/publish-gate.ts).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Built extension bundles (generated, gitignored).
    "extension/dist/**",
  ]),
]);

export default eslintConfig;
