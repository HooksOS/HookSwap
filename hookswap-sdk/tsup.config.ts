import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  // viem is a peer dependency; @hookos/sdk is a runtime dependency the consumer installs.
  external: ['viem', '@hookos/sdk'],
})
