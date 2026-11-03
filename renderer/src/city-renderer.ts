// 렌더러 핵심. React 없는 순수 TS 클래스 → 화면 프레임워크와 상관없이 bench 어댑터가 바로 붙음
//
// 1-3 범위: 타일을 전부 불러와 제자리에 놓고, bench 지점으로 카메라를 맞춤.
// 타일 고르기(1-4)·바이트 예산 캐시(1-5)는 아직 없음.

import {
  Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { cameraPointToMatrix, matrixToCameraPoint, type CameraPoint } from "./geo";
import { loadTileset } from "./tileset";

/** Cesium 기본 시야각 60°. Cesium은 가로·세로 중 긴 쪽에 적용, Three.js는 항상 세로 → 변환해서 같은 화면 범위로 */
const CESIUM_FOV = 60;

export interface LoadResult {
  tiles: number;
  meshes: number;
  /** _FEATURE_ID_0이 없는 메시 수 (0이어야 정상) */
  meshesWithoutFeatureId: number;
}

export class CityRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(CESIUM_FOV, 1, 1, 1e6);
  private readonly loader = new GLTFLoader();
  private readonly frameListeners = new Set<() => void>();

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    // 측정 해상도는 pixelRatio 1로 고정(context 결정). Cesium 기본값(useBrowserRecommendedResolution)도
    // CSS 픽셀 크기로 그려서 같은 조건. devicePixelRatio(M1은 2)를 쓰면 그리는 픽셀이 4배
    this.renderer.setPixelRatio(1);
    container.append(this.renderer.domElement);

    // Cesium 측정 화면과 같은 검은 배경. 빛은 건물 면이 구분될 정도만(색 비교가 아니라 위치 비교용)
    this.scene.background = new Color(0x000000);
    this.scene.add(new HemisphereLight(0xffffff, 0x444444, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.5);
    sun.position.set(1, -1, 2); // 남동쪽 위에서 (지역 좌표 z가 위)
    this.scene.add(sun);

    this.camera.up.set(0, 0, 1); // 지역 좌표는 z가 위
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 가로가 길면 Cesium의 60°는 가로 시야각 → 세로 시야각 = 2·atan(tan(30°) / aspect)
    this.camera.fov =
      aspect >= 1
        ? 2 * Math.atan(Math.tan((CESIUM_FOV / 2) * MathUtils.DEG2RAD) / aspect) * MathUtils.RAD2DEG
        : CESIUM_FOV;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    // near를 카메라 높이에 맞춤: 45km 위에서 near 1m면 깊이 정밀도가 모자라 지붕·벽이 깜빡임(z-fighting)
    const near = MathUtils.clamp(this.camera.position.z / 100, 1, 1000);
    if (near !== this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
    for (const cb of this.frameListeners) cb();
  }

  /** 매 프레임 렌더 직후 호출. 끄는 함수를 돌려줌 */
  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** tileset.json의 타일을 전부 불러와 제자리에 놓음 */
  async loadAll(tilesetUrl: string): Promise<LoadResult> {
    const entries = await loadTileset(tilesetUrl);
    let meshes = 0;
    let meshesWithoutFeatureId = 0;

    await Promise.all(
      entries.map(async (e) => {
        const gltf = await this.loader.loadAsync(e.url);
        const group = gltf.scene;
        // 행렬은 tileset.ts에서 float64로 다 계산함 → Three.js가 위치·회전에서 다시 만들지 않게 고정
        group.matrixAutoUpdate = false;
        group.matrix.copy(e.matrix);
        group.traverse((o) => {
          if (!(o as Mesh).isMesh) return;
          meshes++;
          // GLTFLoader는 모르는 속성 이름을 소문자로 바꿔 넣음: _FEATURE_ID_0 → _feature_id_0
          if (!(o as Mesh).geometry.getAttribute("_feature_id_0")) meshesWithoutFeatureId++;
        });
        this.scene.add(group);
      }),
    );
    return { tiles: entries.length, meshes, meshesWithoutFeatureId };
  }

  setCameraPoint(p: CameraPoint) {
    const m = cameraPointToMatrix(p, new Matrix4());
    m.decompose(this.camera.position, this.camera.quaternion, new Vector3());
    this.camera.updateMatrixWorld();
  }

  getCameraPoint(): CameraPoint {
    this.camera.updateMatrixWorld();
    return matrixToCameraPoint(this.camera.matrixWorld);
  }
}
