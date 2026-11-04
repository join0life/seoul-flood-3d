// 화면 연결: 렌더러 만들기 → 카메라를 bench 지점에 → 타일 전부 불러오기 → 숫자 표시
//
// ?bench=1 : 측정 캔버스 1680×928 고정 (bench/canvas.js, Cesium 측정 화면과 같은 값)
// ?region=gwanak(기본) | seoul
// ?at=overview|zoom|alley|return  : bench/path.json의 그 구간 끝 지점으로 카메라를 둠(Cesium과 같은 자리 비교용)

import { CityRenderer } from "./city-renderer";
import type { CameraPoint } from "./geo";
import path from "../../bench/path.json";
import { createThreeAdapter } from "../../bench/adapters/three.js";
import { mountCopyButton } from "../../bench/panel.js";
import { BENCH_CANVAS, canvasProblem, fixCanvasContainer } from "../../bench/canvas.js";

const params = new URLSearchParams(location.search);
const region = (params.get("region") ?? "gwanak").replace(/[^a-z0-9_-]/gi, "");
const info = document.getElementById("info")!;

const BENCH = params.get("bench") === "1";

// 렌더러가 그릴 칸. 평소엔 창 전체, 측정 화면은 1680×928 고정
const container = document.createElement("div");
container.style.cssText = "position:absolute;inset:0";
document.body.prepend(container);
if (BENCH) {
  container.style.inset = "0 auto auto 0";
  fixCanvasContainer(container);
}

const renderer = new CityRenderer(container);
// 개발 서버가 이 모듈을 갈아끼울 때 이전 렌더러의 GPU 자원·리스너를 정리
import.meta.hot?.dispose(() => renderer.dispose());
const adapter = createThreeAdapter(renderer);
Object.assign(window, { renderer, bench: adapter }); // 콘솔 확인용

// 구간 이름 → 그 구간 끝 지점 (hold는 직전 지점에 머묾)
function pointAt(name: string | null): CameraPoint {
  let at = path.start as CameraPoint;
  for (const s of path.segments) {
    if ("to" in s && s.to) at = s.to as CameraPoint;
    if (s.name === name) return at;
  }
  // ?at= 오타면 조용히 시작 지점으로 가서 놓치기 쉬움 → 알려줌
  if (name !== null) console.warn(`[renderer] ?at=${name}: path.json에 없는 구간 → 시작 지점으로`);
  return path.start as CameraPoint;
}
const at = params.get("at");
adapter.setCamera(pointAt(at));
mountCopyButton(() => adapter.getCamera());

const t0 = performance.now();
const result = await renderer.loadAll(`/${region}/tileset.json`);
const loadMs = performance.now() - t0;

// 다 붙인 뒤 한 프레임 그려지고 나서 renderer.info를 읽음(info.render는 매 프레임 0부터 다시 셈)
const off = renderer.onFrame(() => {
  off();
  const { render, memory } = renderer.renderer.info;
  const canvas = renderer.renderer.domElement;
  const stats = {
    region,
    canvas: `${canvas.width}×${canvas.height}${BENCH ? ` (고정 ${BENCH_CANVAS.width}×${BENCH_CANVAS.height})` : ""}`,
    at: at ?? "start",
    tiles: result.tiles,
    meshes: result.meshes,
    meshesWithoutFeatureId: result.meshesWithoutFeatureId,
    failed: result.failed.length,
    calls: render.calls,
    triangles: render.triangles,
    geometries: memory.geometries,
    loadMs: Math.round(loadMs),
  };
  console.log("[renderer]", stats);
  if (result.meshesWithoutFeatureId) console.warn(`[renderer] _FEATURE_ID_0 없는 메시 ${result.meshesWithoutFeatureId}개`);
  else console.log("[renderer] _FEATURE_ID_0: 모든 메시에 있음");
  info.textContent = Object.entries(stats)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  // 측정 화면인데 창이 작으면 경고(재생 막기는 1-4에서 bench 패널을 붙일 때 같은 canvasProblem으로)
  const problem = BENCH && canvasProblem({ width: canvas.width, height: canvas.height });
  if (problem) info.textContent = `⚠ 측정 불가: ${problem}\n\n` + info.textContent;
});
