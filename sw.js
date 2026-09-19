// 상품코드 스캐너 - 오프라인 캐싱용 서비스 워커
//
// 전략: "캐시에 있으면 캐시 사용, 없으면 네트워크에서 받아온 뒤 캐시에 저장"
// - 페이지 자체(index.html)뿐 아니라, Tesseract.js가 CDN에서 불러오는
//   엔진/코어 스크립트(js, wasm)도 요청되는 대로 자동으로 캐시에 쌓임
// - 언어 인식 모델(kor/eng traineddata)은 Tesseract.js 자체가 IndexedDB에
//   따로 캐싱하므로 이 서비스 워커가 신경 쓸 필요 없음
//
// 즉, 최초 1회는 인터넷이 필요하지만 그 이후로는 이 캐시들 덕분에
// 오프라인에서도 카메라 촬영 → 인식 → 복사까지 전부 동작함

const CACHE_NAME = 'code-scanner-v5';
const PRECACHE_URLS = ['./', './index.html', './icon.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET 요청만 처리 (다른 메서드는 그대로 네트워크로)
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // 정상 응답이거나, CDN처럼 교차 출처라 내용을 못 읽는(opaque)
          // 응답이어도 일단 캐시에 저장해서 다음부터 재사용
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, resClone).catch(() => {});
          });
          return res;
        })
        .catch((err) => {
          // 캐시에도 없고 네트워크도 안 되면(완전 오프라인 + 최초 실행) 실패
          throw err;
        });
    })
  );
});
