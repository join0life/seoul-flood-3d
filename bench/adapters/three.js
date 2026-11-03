// Three.js(내 렌더러) 어댑터. cesium.js와 같은 메서드를 채우는 자리
//
// 좌표 계산은 renderer/src/geo.ts(TypeScript)에 있고, 여기서는 이름만 맞춰 연결함.
// three를 직접 import하지 않는 이유: bench/는 렌더러 패키지 밖이라 three를 찾을 node_modules가 없음
//
// 1-3: setCamera, getCamera만. onFrame·getStats·setInputEnabled·load·describe는 1-4에서

/** @param {import("../../renderer/src/city-renderer").CityRenderer} renderer */
export function createThreeAdapter(renderer) {
  return {
    setCamera: (p) => renderer.setCameraPoint(p),
    getCamera: () => renderer.getCameraPoint(),
  };
}
