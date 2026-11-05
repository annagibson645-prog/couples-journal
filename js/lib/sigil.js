// Path maths for the orbital sigils. All coordinates are in a 200-unit box
// centred on (100,100), except moonPath, which uses a 38-unit box.

const f = (x) => x.toFixed(2);

// Tick marks around a circle. Every fifth tick is "long"; `long` picks which set to draw.
export function tickPath(n, long) {
  let d = '';
  for (let i = 0; i < n; i++) {
    if ((i % 5 === 0) !== long) continue;
    const a = (i / n) * Math.PI * 2;
    const r2 = long ? 82 : 88;
    d += `M${f(100 + Math.cos(a) * 96)} ${f(100 + Math.sin(a) * 96)}` +
         `L${f(100 + Math.cos(a) * r2)} ${f(100 + Math.sin(a) * r2)}`;
  }
  return d;
}

// Zero-length segments with round caps draw as dots on a ring of radius 92.
export function dotPath(n) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    d += `M${f(100 + Math.cos(a) * 92)} ${f(100 + Math.sin(a) * 92)}l0 0`;
  }
  return d;
}

// Moon with fraction lit p (0 new, 1 full), in a 38-unit box (centre 19,19, radius 17).
// Waxing: the right side is lit.
export function moonPath(p) {
  const R = 17;
  if (!(p > 0)) return 'M19 19Z'; // new moon: a point, no area
  if (p >= 1) return `M19 2A${R} ${R} 0 1 1 19 36A${R} ${R} 0 1 1 19 2Z`; // full circle
  const rx = Math.abs(1 - 2 * p) * R;
  // Outer limb on the right, then the terminator back up: bulging right for a
  // crescent (p < .5), left for gibbous (p > .5).
  const sweep = p < 0.5 ? 0 : 1;
  return `M19 2A${R} ${R} 0 0 1 19 36A${f(rx)} ${R} 0 0 ${sweep} 19 2Z`;
}
