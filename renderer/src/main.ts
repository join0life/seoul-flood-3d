// 화면 연결: 렌더러 만들기 → 카메라를 bench 지점에 → 타일 전부 불러오기 → 숫자 표시
//
// ?region=gwanak(기본) | seoul
// ?at=overview|zoom|alley|return  : bench/path.json의 그 구간 끝 지점으로 카메라를 둠(Cesium과 같은 자리 비교용)

import { CityRenderer } from "./city-renderer";
import type { CameraPoint } from "./geo";
import path from "../../bench/path.json";
import { createThreeAdapter } from "../../bench/adapters/three.js";
import { mountCopyButton } from "../../bench/panel.js";

const params = new URLSearchParams(location.search);
const region = (params.get("region") ?? "gwanak").replace(/[^a-z0-9_-]/gi, "");
const info = document.getElementById("info")!;

const renderer = new CityRenderer(document.body);
const adapter = createThreeAdapter(renderer);
Object.assign(window, { renderer, bench: adapter }); // 콘솔 확인용

// 구간 이름 → 그 구간 끝 지점 (hold는 직전 지점에 머묾)
function pointAt(name: string | null): CameraPoint {
  let at = path.start as CameraPoint;
  for (const s of path.segments) {
    if ("to" in s && s.to) at = s.to as CameraPoint;
    if (s.name === name) return at;
  }
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
  const stats = {
    region,
    at: at ?? "start",
    tiles: result.tiles,
    meshes: result.meshes,
    meshesWithoutFeatureId: result.meshesWithoutFeatureId,
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
});
