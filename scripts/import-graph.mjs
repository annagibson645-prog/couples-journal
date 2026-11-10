// Walks the static import graph from js/app.js. Used by the modulepreload drift test and for measuring depth.
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;

// Returns { files, depth, longest }.
//  files:   sorted root-relative paths (forward slashes)
//  depth:   network levels a browser needs: a module is fetched as soon as ANY importer is parsed, so this is the
//           longest of the SHORTEST paths from the entry (breadth-first level). 1 = only the entry file.
//  longest: longest dependency chain (matters for evaluation order and for engines that do not overlap fetches).
export function importGraph(entry = 'js/app.js') {
  const level = new Map(); // file -> first (shortest) level
  const edges = new Map();
  let frontier = [resolve(ROOT, entry)];
  for (let d = 1; frontier.length; d++) {
    const next = [];
    for (const file of frontier) {
      if (level.has(file)) continue;
      level.set(file, d);
      const deps = [...readFileSync(file, 'utf8').matchAll(IMPORT_RE)].map((m) => resolve(dirname(file), m[1] || m[2]));
      edges.set(file, deps);
      next.push(...deps);
    }
    frontier = next;
  }
  const memo = new Map();
  const chain = (f, seen = new Set()) => {
    if (memo.has(f)) return memo.get(f);
    if (seen.has(f)) return 0; // cycle guard
    seen.add(f);
    const n = 1 + Math.max(0, ...(edges.get(f) || []).map((x) => chain(x, seen)));
    seen.delete(f);
    memo.set(f, n);
    return n;
  };
  const files = [...level.keys()].map((f) => relative(ROOT, f).split(sep).join('/')).sort();
  return { files, depth: Math.max(...level.values()), longest: chain(resolve(ROOT, entry)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const g = importGraph();
  console.log(JSON.stringify({ count: g.files.length, depth: g.depth, longest: g.longest }), '\n' + g.files.join('\n'));
}
