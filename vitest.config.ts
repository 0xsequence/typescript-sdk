import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
    test: {
        fileParallelism: false,
        include: ["tests/**/*.ts"]
    },
});