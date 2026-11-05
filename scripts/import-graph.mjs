// Walks the static import graph from js/app.js. Used by the modulepreload drift test and for measuring depth.
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;

// Returns { files: sorted root-relative paths with forward slashes, depth: number of sequential fetch levels }.
export function importGraph(entry = 'js/app.js') {
  const depthOf = new Map();
  const queue = [[resolve(ROOT, entry), 1]];
  while (queue.length) {
    const [file, d] = queue.shift();
    if (depthOf.has(file) && depthOf.get(file) >= d) continue;
    depthOf.set(file, d);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      queue.push([resolve(dirname(file), m[1] || m[2]), d + 1]);
    }
  }
  const files = [...depthOf.keys()].map((f) => relative(ROOT, f).split(sep).join('/')).sort();
  return { files, depth: Math.max(...depthOf.values()) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const g = importGraph();
  console.log(JSON.stringify({ count: g.files.length, depth: g.depth }), '\n' + g.files.join('\n'));
}
