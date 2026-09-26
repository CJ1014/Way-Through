// Bundles src/ + vendored three.js into one classic (non-module) script: dist/game.js.
// index.html loads it with a plain <script> tag, so the game runs from file:// with no server.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/game.js',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'eof',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching src/ ...');
} else {
  await esbuild.build(options);
}
