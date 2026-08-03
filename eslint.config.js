import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

export default [
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            boundaries,
        },
        settings: {
            // Resolve .js imports to .ts files (TypeScript ESM convention)
            "import/resolver": {
                typescript: {
                    alwaysTryTypes: true,
                },
            },
            // Define architectural elements for eslint-plugin-boundaries.
            // Order matters: first matching descriptor wins. Specific
            // elements (shared, hooks, types) must come before the
            // catch-all "feature" pattern.
            "boundaries/elements": [
                {
                    type: "shared",
                    pattern: "src/shared",
                    mode: "folder",
                },
                {
                    type: "hooks",
                    pattern: "src/hooks",
                    mode: "folder",
                },
                {
                    type: "types",
                    pattern: "src/types",
                    mode: "folder",
                },
                {
                    type: "feature",
                    pattern: "src/sync",
                    mode: "folder",
                },
                {
                    type: "feature",
                    pattern: "src/rulesets/sf2e/*",
                    mode: "folder",
                    capture: ["elementName"],
                },
            ],
        },
        rules: {
            // ─── TypeScript Rules ────────────────────────────────────────────

            // Catch accidental `as any` regressions — warn, don't block
            "@typescript-eslint/no-explicit-any": "warn",

            // Catch unused variables (ignore prefixed with _)
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],

            // Prevent accidental console.log (allow warn/error/info)
            "no-console": ["warn", { allow: ["warn", "error", "info", "log"] }],

            // Require explicit return types on exported functions
            "@typescript-eslint/explicit-module-boundary-types": "off",

            // Prefer const
            "prefer-const": "warn",

            // No var
            "no-var": "error",

            // ─── Boundary Rules ──────────────────────────────────────────────

            // Use recommended config as a base
            ...boundaries.configs.recommended.rules,

            // Features can only be imported through their index.ts barrel.
            // Within the same feature, any file can import any other file.
            // From outside the feature, only index.ts is allowed.
            "boundaries/entry-point": [2, {
                default: "allow",
                rules: [
                    {
                        target: ["feature"],
                        disallow: "*",
                    },
                    {
                        target: ["feature"],
                        allow: "index.{ts,js}",
                    },
                ],
            }],

            // Enforce import direction: shared must not depend on features or hooks.
            "boundaries/element-types": [2, {
                default: "allow",
                rules: [
                    {
                        from: ["shared"],
                        disallow: ["feature", "hooks"],
                        message: "src/shared/ must not import from features or hooks. Move shared code here, or restructure the dependency.",
                    },
                ],
            }],
        },
    },
    {
        files: ["plugin/src/**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "no-console": ["warn", { allow: ["warn", "error", "info", "log"] }],
            "prefer-const": "warn",
            "no-var": "error",
        },
    },
    {
        // Ignore build output and config files
        ignores: ["dist/**", "plugin/dist/**", "node_modules/**", "*.config.*"],
    },
];
