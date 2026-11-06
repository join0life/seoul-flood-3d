// Cesium 전용 부분만 모은 어댑터. player.js·recorder.js는 이 파일의 메서드만 부름
// 1-3에서 같은 메서드를 가진 Three.js 어댑터로 바꿔 끼움
//
// 공개 API만 사용: camera.setView, scene.postRender, tileset.tileLoad / tileUnload / loadProgress /
// initialTilesLoaded, tileset.totalMemoryUsageInBytes. private(statistics 등)은 버전마다 바뀔 수 있어 안 씀
//
// 전역 Cesium(cesium-check.html의 <script>)을 씀. import하지 않는 이유: CDN 스크립트 하나로 SRI 검사까지 끝내려고

const { Cartesian3, Math: CMath } = Cesium;

/** 현재 카메라 → 지점 { lon, lat, height(타원체 높이 m), heading, pitch (도) } */
export function getCesiumCamera(viewer) {
  const { camera } = viewer;
  const c = camera.positionCartographic;
  return {
    lon: CMath.toDegrees(c.longitude),
    lat: CMath.toDegrees(c.latitude),
    height: c.height,
    heading: CMath.toDegrees(camera.heading),
    pitch: CMath.toDegrees(camera.pitch),
  };
}

/**
 * 측정 조건을 적용하고 어댑터를 돌려줌. 타일셋은 load()를 부를 때 만듦
 * → 재생 버튼을 누르기 전에는 타일을 하나도 안 받음 (첫 방문 측정이 깨끗하게 시작)
 */
export function createCesiumAdapter(viewer, tilesetUrl) {
  const { scene } = viewer;

  // 내 렌더러는 건물만 그림 → 건물 그리는 비용끼리 비교하려고 건물 말고는 다 끔
  // (바탕 지도는 Viewer를 baseLayer: false로 만들어서 이미 없음)
  scene.globe.show = false;
  scene.skyAtmosphere.show = false;
  scene.skyBox.show = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.fog.enabled = false;

  // 한 프레임 작업 시간 = preUpdate(장면 갱신 시작) ~ postRender(그리기 명령 끝)
  // 프레임 간격은 화면 주사율(60Hz → 16.67ms)에 묶여서, 일이 적은 프레임끼리는 차이가 안 보임
  let workStart = 0;
  scene.preUpdate.addEventListener(() => (workStart = performance.now()));

  let tileset = null;
  let tilesLoaded = 0;
  let tilesUnloaded = 0;
  let pendingRequests = 0;

  return {
    get tileset() {
      return tileset;
    },

    /**
     * 첫 호출: tileset.json을 받아 장면에 넣고, initialTilesLoaded 때 resolve하는 Promise를 돌려줌
     * 두 번째부터(재방문): 이미 있으니 null
     */
    load() {
      if (tileset) return null;
      return (async () => {
        tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetUrl); // 옵션은 기본값 그대로
        tileset.tileLoad.addEventListener(() => tilesLoaded++);
        tileset.tileUnload.addEventListener(() => tilesUnloaded++);
        // loadProgress는 대기 요청 수가 바뀔 때마다 옴 → 마지막 값을 들고 있다가 getStats에서 줌
        tileset.loadProgress.addEventListener((pending) => (pendingRequests = pending));
        const initial = new Promise((r) => tileset.initialTilesLoaded.addEventListener(r));
        scene.primitives.add(tileset);
        await initial;
      })();
    },

    setCamera(p) {
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(p.lon, p.lat, p.height),
        orientation: { heading: CMath.toRadians(p.heading), pitch: CMath.toRadians(p.pitch), roll: 0 },
      });
    },

    getCamera: () => getCesiumCamera(viewer),

    /** 매 프레임 렌더 직후 cb(작업 시간 ms) 호출. 끄는 함수를 돌려줌 */
    onFrame(cb) {
      return scene.postRender.addEventListener(() => cb(performance.now() - workStart));
    },

    /**
     * 캔버스를 PNG data URL로. onFrame 콜백(= scene.postRender) 안에서만 부를 것:
     * WebGL은 화면에 내보낸 뒤 그리기 버퍼를 비울 수 있어서(preserveDrawingBuffer: false) 그린 직후가 아니면 빈 그림
     */
    captureNow: () => viewer.canvas.toDataURL("image/png"),

    setInputEnabled(on) {
      scene.screenSpaceCameraController.enableInputs = on;
    },

    /** 누적 값. 구간 값은 recorder가 빼서 계산 */
    getStats() {
      return {
        tilesLoaded,
        tilesUnloaded,
        pendingRequests,
        memoryBytes: tileset ? tileset.totalMemoryUsageInBytes : 0,
      };
    },

    /** 결과 JSON에 남길 조건. 타일셋 옵션은 바꾸지 않고 기본값을 읽어서 기록만 함 */
    describe() {
      const { canvas } = viewer;
      return {
        renderer: "cesium",
        tilesetUrl: new URL(tilesetUrl, location.href).href, // 전송 기록(recorder)이 이 폴더 아래 요청만 셈
        version: Cesium.VERSION,
        canvas: {
          cssWidth: canvas.clientWidth,
          cssHeight: canvas.clientHeight,
          width: canvas.width, // 실제 그리는 픽셀(드로잉 버퍼)
          height: canvas.height,
        },
        resolutionScale: viewer.resolutionScale,
        useBrowserRecommendedResolution: viewer.useBrowserRecommendedResolution,
        requestRenderMode: scene.requestRenderMode,
        scene: { baseLayer: false, globe: false, skyAtmosphere: false, skyBox: false, sunMoon: false, fog: false },
        tileset: tileset && {
          maximumScreenSpaceError: tileset.maximumScreenSpaceError,
          cacheBytes: tileset.cacheBytes,
          maximumCacheOverflowBytes: tileset.maximumCacheOverflowBytes,
          dynamicScreenSpaceError: tileset.dynamicScreenSpaceError,
          foveatedScreenSpaceError: tileset.foveatedScreenSpaceError,
          skipLevelOfDetail: tileset.skipLevelOfDetail,
        },
      };
    },
  };
}
