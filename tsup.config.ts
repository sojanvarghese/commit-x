import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: 'inline', // Use inline sourcemaps for better performance
  minify: true, // Enable minification for smaller bundles
  splitting: true, // Enable code splitting for better chunk loading
  treeshake: true,
  external: [
    '@google/genai',
    'commander',
    'simple-git',
    'gradient-string',
    'ts-pattern',
    'zod',
  ],
  esbuildOptions(options) {
    options.treeShaking = true;
    options.minifyIdentifiers = true;
    options.minifySyntax = true;
    options.minifyWhitespace = true;
    options.mangleProps = /^_/;
  },
  onSuccess: 'echo "Build completed successfully!"',
});
