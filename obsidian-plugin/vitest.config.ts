import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/test/**/*.test.ts'],
		environment: 'node',
		alias: {
			// The real `obsidian` npm package is TYPES ONLY (no runtime JS) —
			// see src/test/obsidian-stub.ts for why this alias exists and why
			// it is test-only (esbuild.config.mjs, the real production build,
			// marks `obsidian` external instead).
			obsidian: path.resolve(__dirname, 'src/test/obsidian-stub.ts'),
		},
	},
});
