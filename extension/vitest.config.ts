import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "happy-dom",
        include: ["extension/tests/**/*.test.ts"],
        restoreMocks: true,
    },
});
