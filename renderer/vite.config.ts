import { defineConfig } from "vite";

export default defineConfig({
  // 타일은 data/tiles 아래만 내보냄 → /gwanak/tileset.json, /seoul/tileset.json
  // (data/ 전체를 열면 침수 원본 SHP 같은 개별 정보까지 개발 서버에 노출됨)
  publicDir: "../data/tiles",
  // 빌드할 때 서울 타일 825MB를 결과 폴더에 복사하지 않게
  build: { copyPublicDir: false },
  // bench/(경로·버튼·어댑터)와 shared/(타일러와 같이 쓰는 좌표 공식)는 렌더러 폴더 밖이라 그 폴더만 읽기 허용
  server: { fs: { allow: [".", "../bench", "../shared"] } },
});
