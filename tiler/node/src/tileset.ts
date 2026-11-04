import type { Enu } from "../../../shared/geo.js";
import { enuToEcefMatrix } from "../../../shared/geo.js";
import type { TileNode } from "./quadtree.js";

type Mat4 = number[]; // 4×4 열 우선

function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
/** 회전 + 이동만 있는 행렬의 역행렬 */
function invertRigid(m: Mat4): Mat4 {
  const R = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const t = [m[12], m[13], m[14]];
  const o = [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, 0, 0, 0, 1];
  for (let i = 0; i < 3; i++) o[12 + i] = -(o[i] * t[0] + o[4 + i] * t[1] + o[8 + i] * t[2]);
  return o;
}
const rad = (d: number) => (d * Math.PI) / 180;

/** tileset.json에 쓰는 타일 한 칸 (3D Tiles 1.1 중 이 타일러가 쓰는 필드만). 필드를 빠뜨리거나 잘못 쓰면 컴파일 때 잡힘 */
export interface TileJson {
  boundingVolume: { region: [number, number, number, number, number, number] };
  geometricError: number;
  refine?: "ADD" | "REPLACE";
  transform: Mat4;
  content: { uri: string };
  children?: TileJson[];
}
export interface TilesetJson {
  asset: { version: "1.1" };
  geometricError: number;
  root: TileJson;
}

/** tileset.json 만들기. transform은 부모 기준으로 곱해지므로, 자식은 "부모 → 자식" 상대 행렬을 넣음 */
export function buildTileset(root: TileNode, enuOf: Map<string, Enu>, rootError: number): TilesetJson {
  function toJson(t: TileNode, parentWorld: Mat4 | null): TileJson {
    const world = enuToEcefMatrix(enuOf.get(t.id)!);
    const transform = parentWorld ? multiply(invertRigid(parentWorld), world) : world;
    const [w, s, e, n, maxH] = t.region;
    return {
      boundingVolume: { region: [rad(w), rad(s), rad(e), rad(n), 0, maxH] }, // region은 transform 영향 안 받음
      geometricError: t.geometricError,
      ...(parentWorld ? {} : { refine: "ADD" }), // 루트에만 적으면 자식이 물려받음
      transform,
      content: { uri: `tiles/${t.id}.glb` },
      ...(t.children.length ? { children: t.children.map((c) => toJson(c, world)) } : {}),
    };
  }
  return {
    asset: { version: "1.1" },
    geometricError: rootError, // 아무것도 안 그렸을 때 빠지는 가장 큰 건물 크기
    root: toJson(root, null),
  };
}