import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
    test: {
        // optional: a setup file if you need more than env loading
        // setupFiles: ["./src/__tests__/setup.ts"],
        fileParallelism: false, // keeps the auth flow serial
    },
});