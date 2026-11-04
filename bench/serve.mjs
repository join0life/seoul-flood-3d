// 측정용 정적 서버. python -m http.server 8080 대신 씀 (루트에서 실행, 포트·경로 같음)
// 실행: node bench/serve.mjs [포트=8080]   (라이브러리 없음, Node 내장 모듈만)
//
// python http.server와 다른 건 압축 여부 하나만 되게 맞춤:
//   - 미리 만든 파일.br / 파일.gz가 있으면 Accept-Encoding을 보고 br → gzip → 원본 순으로 골라 보냄
//     (요청마다 압축하면 압축하는 CPU 시간이 측정에 섞임 → bench/compress-tiles.mjs로 미리 만듦)
//   - Connection: close: python http.server는 HTTP/1.0이라 요청마다 연결을 새로 맺음. Node 기본 keep-alive를 쓰면
//     연결 재사용으로 지연이 줄어 "압축 효과"와 섞이므로 같게 맞춤
//   - Last-Modified + If-Modified-Since → 304: python과 같은 캐시 동작(재방문 조건 유지)
//   - Content-Type: python mimetypes와 같은 값(.glb는 python처럼 application/octet-stream)
// 다른 점: 127.0.0.1에만 열림(python 기본은 0.0.0.0 → 같은 와이파이의 다른 기기에서도 data/가 보임)

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PORT = Number(process.argv[2] ?? 8080);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function stat(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/** Accept-Encoding을 보고 보낼 파일을 고름: br → gzip → 원본 */
function pick(file, acceptEncoding) {
  // "gzip, br;q=0.5, *;q=0" → { gzip: 1, br: 0.5, "*": 0 }. q=0은 "받지 않음"
  const q = {};
  for (const part of acceptEncoding.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const qp = params.map((x) => x.trim()).find((x) => x.startsWith("q="));
    q[name] = qp ? Number(qp.slice(2)) : 1;
  }
  const accepts = (name) => (q[name] ?? q["*"] ?? 0) > 0;
  for (const [enc, ext] of [["br", ".br"], ["gzip", ".gz"]]) {
    if (!accepts(enc)) continue;
    const s = stat(file + ext);
    // 원본보다 오래된 압축 파일은 내용이 다를 수 있어서 안 씀 → 압축 스크립트를 다시 돌릴 것
    if (s?.isFile() && s.mtimeMs >= stat(file).mtimeMs) return { path: file + ext, size: s.size, encoding: enc };
  }
  return { path: file, size: stat(file).size, encoding: null };
}

createServer((req, res) => {
  res.setHeader("Connection", "close");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(501).end();
    return;
  }

  // 경로 정리: ../ 로 루트 밖을 읽지 못하게
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = normalize(join(ROOT, urlPath));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  let s = stat(file);
  if (s?.isDirectory()) {
    file = join(file, "index.html");
    s = stat(file);
  }
  if (!s?.isFile()) {
    res.writeHead(404).end();
    return;
  }

  // python과 같은 캐시 동작: 초 단위 Last-Modified, If-Modified-Since가 같거나 나중이면 304
  const lastModified = new Date(Math.floor(s.mtimeMs / 1000) * 1000);
  const since = Date.parse(req.headers["if-modified-since"] ?? "");
  if (!Number.isNaN(since) && lastModified.getTime() <= since) {
    res.writeHead(304, { "Last-Modified": lastModified.toUTCString() }).end();
    return;
  }

  const chosen = pick(file, req.headers["accept-encoding"] ?? "");
  const headers = {
    "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": chosen.size,
    "Last-Modified": lastModified.toUTCString(),
    // 같은 주소라도 Accept-Encoding에 따라 내용이 다름 → 캐시가 섞이지 않게
    Vary: "Accept-Encoding",
  };
  if (chosen.encoding) headers["Content-Encoding"] = chosen.encoding;
  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else createReadStream(chosen.path).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`http://localhost:${PORT}/  (루트: ${ROOT}, 미리 압축한 .br/.gz 있으면 사용)`);
});
