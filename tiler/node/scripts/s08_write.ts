import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Enu } from "../src/geo.js";
import { writeTileGlb } from "../src/glb.js";
import { loadBuildings } from "../src/load.js";
import { buildTileMesh } from "../src/mesh.js";
import { buildQuadtree, type TileNode } from "../src/quadtree.js";
import { buildTileset } from "../src/tileset.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = resolve(root, "data/tiles/gwanak");
rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "tiles"), { recursive: true });

const t0 = performance.now();
const buildings = await loadBuildings(resolve(root, "data/work/gwanak.fgb"));
const tree = buildQuadtree(buildings);
const tiles: TileNode[] = [];
(function walk(n: TileNode) {
  tiles.push(n);
  n.children.forEach(walk);
})(tree);

const enuOf = new Map<string, Enu>();
let total = 0,
  maxSize = 0,
  uint16 = 0;
for (const tile of tiles) {
  const mesh = buildTileMesh(tile);
  enuOf.set(tile.id, mesh.enu);
  if (mesh.positions.length / 3 < 65536) uint16++;
  const glb = await writeTileGlb(tile, mesh);
  writeFileSync(resolve(out, `tiles/${tile.id}.glb`), glb);
  total += glb.byteLength;
  maxSize = Math.max(maxSize, glb.byteLength);
}
const rootError = Math.max(...buildings.map((b) => b.size));
writeFileSync(
  resolve(out, "tileset.json"),
  JSON.stringify(buildTileset(tree, enuOf, rootError), null, 2),
);
const t1 = performance.now();

const src = statSync(resolve(root, "data/work/gwanak.fgb")).size;
console.log(
  `GLB ${tiles.length}개 · 총 ${(total / 1e6).toFixed(1)}MB · 평균 ${(total / tiles.length / 1e3).toFixed(0)}KB · 최대 ${(maxSize / 1e3).toFixed(0)}KB`,
);
console.log(`인덱스 Uint16 ${uint16}개 / Uint32 ${tiles.length - uint16}개`);
console.log(`(참고) 입력 gwanak.fgb ${(src / 1e6).toFixed(1)}MB`);
console.log(
  `tileset.json 저장 · 루트 geometricError ${rootError.toFixed(1)}m · ${((t1 - t0) / 1000).toFixed(1)}s`,
);
console.log(`→ ${out}`);
