// bench/results/*.json을 읽어 {renderer, region, first|revisit}별 평균 표를 출력
// 실행: node bench/summarize.mjs [결과 폴더]   (라이브러리 없음, Node 내장 모듈만)
//
// 평균 내기 전에 검사하는 것
//   - 같은 묶음의 결과가 같은 path로 잰 것인지 (경로가 다르면 평균이 의미 없음 → 멈춤)
//   - 구간 끝 카메라가 회차끼리 같은지 (최대 차이를 m로 출력)
//   - 3회가 아니면 표에 "n회"로 표시 (1회 값을 평균처럼 보이지 않게)

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), "../results"));
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
if (!files.length) {
  console.error(`${dir}에 결과 JSON이 없음`);
  process.exit(1);
}

const groups = new Map();
for (const f of files) {
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const key = `${r.renderer}_${r.region}_${r.kind}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ file: f, ...r });
}

const mean = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const fix = (x, d = 1) => (x == null ? "【 】" : Number(x.toFixed(d)));

// 두 지점 사이 거리(m). 서울 범위에서는 평면 근사로 충분
function distance(a, b) {
  const R = 6378137;
  const rad = Math.PI / 180;
  const dx = (b.lon - a.lon) * rad * R * Math.cos(a.lat * rad);
  const dy = (b.lat - a.lat) * rad * R;
  return Math.hypot(dx, dy, b.height - a.height);
}

for (const [key, runs] of groups) {
  const paths = new Set(runs.map((r) => JSON.stringify(r.path)));
  if (paths.size > 1) {
    console.error(`${key}: path가 다른 결과가 섞임 → ${runs.map((r) => r.file).join(", ")}`);
    process.exit(1);
  }
  const label = runs.length === 3 ? "3회 평균" : `${runs.length}회${runs.length > 1 ? " 평균" : ""} (3회 아님)`;
  console.log(`\n■ ${key} · ${label} · ${runs.map((r) => r.file).join(", ")}`);
  console.log(`  initialTilesLoaded: ${fix(mean(runs.map((r) => r.initialTilesLoadedMs)), 0)} ms`);

  const rows = runs[0].segments.map((s, i) => {
    const at = (k) => runs.map((r) => r.segments[i][k]);
    // 구간 끝 카메라: 첫 회차 기준으로 나머지 회차가 얼마나 다른지
    const cams = at("endCamera");
    const camDiff = Math.max(0, ...cams.slice(1).map((c) => distance(cams[0], c)));
    const slow = mean(at("slowFrameRatio"));
    const mem = mean(at("memoryBytesAtEnd"));
    return {
      구간: s.name,
      프레임: fix(mean(at("frames")), 0),
      평균ms: fix(mean(at("avgFrameMs")), 2),
      최대ms: fix(mean(at("maxFrameMs"))),
      "느린%": fix(slow == null ? null : slow * 100),
      불러옴: fix(mean(at("tilesLoaded")), 1),
      내림: fix(mean(at("tilesUnloaded")), 1),
      대기요청: fix(mean(at("pendingRequestsAtEnd")), 1),
      메모리MB: fix(mem == null ? null : mem / 1e6),
      "끝카메라차m": runs.length > 1 ? Number(camDiff.toExponential(2)) : "-",
    };
  });
  console.table(rows);
}
