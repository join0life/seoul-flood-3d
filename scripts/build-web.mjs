// 배포용 정적 파일 폴더(dist/) 만들기. 실행: node scripts/build-web.mjs (저장소 루트에서, 라이브러리 없음)
// 화면이 실제로 불러오는 파일만 골라서 지금과 같은 폴더 구조로 복사 → ../schema/, ../bench/ 상대 경로가 그대로 맞음
// 타일(data/)은 넣지 않음: 배포본은 R2에서 받음(cesium-check.html TILE_SOURCES). CesiumJS는 jsDelivr CDN
// 결과는 dist/ (.gitignore). 배포: npx wrangler deploy (wrangler.jsonc의 assets.directory = ./dist)

import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const OUT = join(ROOT, "dist");

const FILES = [
  // 화면
  "viewer/cesium-check.html",
  "viewer/layer-style.js",
  "viewer/building-detail.js",
  "viewer/funnel.js",
  "viewer/district-list.js",
  "viewer/toggle-measure.js", // ?measure=1일 때만 불림
  // ?bench=1·?measure=1·?debug=1일 때만 불리는 측정 도구
  "bench/canvas.js",
  "bench/panel.js",
  "bench/player.js",
  "bench/recorder.js",
  "bench/adapters/cesium.js",
  "bench/path.json",
  // 속성 이름 대조(layer-style.js가 import)
  "schema/building.json",
];

rmSync(OUT, { recursive: true, force: true });
for (const f of FILES) {
  mkdirSync(dirname(join(OUT, f)), { recursive: true });
  copyFileSync(join(ROOT, f), join(OUT, f));
}
// 루트 주소(/)로 열면 화면으로. Workers 정적 파일이 _redirects를 읽음
writeFileSync(join(OUT, "_redirects"), "/ /viewer/cesium-check.html 302\n");

// 결과 확인: 목록·총 크기, 들어가면 안 되는 것(node_modules, .DS_Store)이 없는지
const list = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p) : list.push(p);
  }
})(OUT);
const bad = list.filter((p) => /(^|\/)(node_modules|\.DS_Store)(\/|$)/.test(relative(OUT, p)));
if (bad.length) throw new Error(`dist에 들어가면 안 되는 파일: ${bad.join(", ")}`);
let total = 0;
for (const p of list.sort()) {
  const size = statSync(p).size;
  total += size;
  console.log(`${String(size).padStart(9)}  ${relative(OUT, p)}`);
}
console.log(`→ dist/ · 파일 ${list.length}개 · ${(total / 1024).toFixed(1)}KB · node_modules·.DS_Store 없음`);
