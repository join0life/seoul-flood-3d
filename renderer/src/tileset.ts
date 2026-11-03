// tileset.json 읽기: 트리를 돌면서 타일마다 "지역 좌표에 놓는 최종 행렬"을 계산
//
// 1-3은 타일을 전부 펼쳐서 목록으로 돌려줌(고르기는 1-4).

import { Matrix4 } from "three";
import { ECEF_TO_LOCAL } from "./geo";

interface TileJson {
  transform?: number[];
  geometricError: number;
  content?: { uri: string };
  children?: TileJson[];
}

export interface TileEntry {
  url: string; // GLB 주소
  depth: number;
  geometricError: number;
  /** 타일 GLB 안의 좌표 → 지역 좌표 */
  matrix: Matrix4;
}

/**
 * glTF는 y가 위, 3D Tiles는 z가 위 → x축으로 +90° 돌림 (3D Tiles 표준의 y-up → z-up 변환)
 *   glTF (x, y, z) → (x, -z, y)
 * 우리 GLB는 타일러가 ENU [동, 북, 위]를 [동, 위, -북]으로 바꿔 저장했으므로(tiler glb.ts enuToGltf),
 * 이 회전을 거치면 다시 [동, 북, 위]가 됨
 */
const Y_UP_TO_Z_UP = new Matrix4().makeRotationX(Math.PI / 2);

export async function loadTileset(url: string): Promise<TileEntry[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const json = await res.json();
  const base = new URL(url, location.href);
  const out: TileEntry[] = [];

  // parentWorld = 부모까지 곱한 "부모 좌표 → ECEF" 행렬
  function walk(tile: TileJson, parentWorld: Matrix4, depth: number) {
    // 3D Tiles: 자식 transform은 부모 좌표계 기준 상대값 → world = 부모 world × 자기 transform
    // (오른쪽부터 적용: 타일 안 좌표를 자기 transform으로 부모 좌표로, 다시 부모 world로 ECEF로)
    const world = parentWorld.clone();
    if (tile.transform) world.multiply(new Matrix4().fromArray(tile.transform)); // tileset.json은 열 우선 = Three.js fromArray와 같음

    if (tile.content) {
      // 최종 = ECEF→지역 × world × (y-up→z-up)
      //   오른쪽부터: GLB 좌표를 z-up으로 → 타일 좌표에서 ECEF로 → ECEF에서 서울 지역 좌표로
      // 이 곱셈은 JS의 float64에서 함. 400만 m대 ECEF 값은 여기서 빠지고, GPU에는 원점 기준 km 단위만 감(RTC)
      const matrix = ECEF_TO_LOCAL.clone().multiply(world).multiply(Y_UP_TO_Z_UP);
      out.push({
        url: new URL(tile.content.uri, base).href,
        depth,
        geometricError: tile.geometricError,
        matrix,
      });
    }
    for (const c of tile.children ?? []) walk(c, world, depth + 1);
  }

  walk(json.root, new Matrix4(), 0);
  return out;
}
