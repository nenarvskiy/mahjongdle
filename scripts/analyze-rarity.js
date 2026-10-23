import { calcShanten } from '../src/shanten.js';
import { handToCounts } from '../src/tile-index.js';
import { buildWall } from '../src/tiles.js';

const samples = Number(process.env.SAMPLES ?? 50_000);
let seed = 0x13a7b00b;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const baseWall = buildWall();
const shanten = {};
let honorPair = 0;
let honorTriplet = 0;

for (let sample = 0; sample < samples; sample++) {
  const wall = baseWall.slice();
  for (let i = wall.length - 1; i > wall.length - 14; i--) {
    const j = Math.floor(random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const counts = handToCounts(wall.slice(-13));
  const value = calcShanten(counts);
  shanten[value] = (shanten[value] ?? 0) + 1;
  if ([27, 28, 29, 30, 31, 32, 33].some((tile) => counts[tile] >= 2)) honorPair++;
  if ([27, 28, 29, 30, 31, 32, 33].some((tile) => counts[tile] >= 3)) honorTriplet++;
}

const percent = (count) => `${(count / samples * 100).toFixed(3)}%`;
console.log(JSON.stringify({
  samples,
  shanten: Object.fromEntries(Object.entries(shanten).map(([key, count]) => [key, { count, rate: percent(count) }])),
  honorPair: { count: honorPair, rate: percent(honorPair) },
  honorTriplet: { count: honorTriplet, rate: percent(honorTriplet) },
  pairToTripletRatio: Number((honorPair / honorTriplet).toFixed(2)),
}, null, 2));
