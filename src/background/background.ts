const BASE_URL = "http://localhost:8080";
const FETCH_TIMEOUT_MS = 8000;
const MOCK_MODE = false; // 서버 미연결 시 UI 테스트용. 실서버 연결 시 false로 변경

const MOCK_TAG_SETS = [
  ["뉴스", "속보"], ["광고", "쇼핑"], ["공식사이트"],
  ["블로그", "후기"], ["유튜브", "영상"], ["위키", "정보"],
  ["커뮤니티", "Q&A"], ["논문", "학술"],
];
const MOCK_LIKE_COUNTS = [3, 7, 12, 5, 19, 2, 8, 15, 1, 23];
const MOCK_COMMENTS = [
  ["유용한 정보네요", "참고가 됩니다"],
  ["출처가 신뢰할 만해요", "속보 기사입니다"],
  ["공식 정보라 믿을 수 있어요"],
  ["개인 블로그 후기예요", "주관적 의견 포함"],
];
const mockLikedUrls = new Set<string>();

const getMockHash = (url: string) => {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) & 0xfffffff;
  }
  return Math.abs(hash);
};

console.log("[BG] background.ts 로드됨");

const fetchWithTimeout = async (url: string, options: RequestInit) => {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
    console.warn("[BG] fetch 타임아웃:", url);
  }, FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return res;
  } finally {
    clearTimeout(timer);
  }
};

chrome.runtime.onConnect.addListener((port) => {
  console.log("[BG] 포트 연결됨:", port.name);

  port.onDisconnect.addListener(() => {
    console.log("[BG] 포트 끊김:", port.name);
  });

  port.onMessage.addListener(async (message: Record<string, unknown>) => {
    const { id, type } = message as {
      id: number;
      type: string;
    };

    console.log(`[BG] 메시지 수신 - id=${id}, type=${type}`);

    let data: unknown;

    try {
      if (type === "GET_LINK_RATINGS") {
        console.log("[BG] GET_LINK_RATINGS 요청, urls:", message.urls);
        if (MOCK_MODE) {
          const urls = message.urls as string[];
          data = {
            success: true,
            data: urls.map((url, i) => ({
              url,
              linkId: i + 1,
              likeCount: MOCK_LIKE_COUNTS[getMockHash(url) % MOCK_LIKE_COUNTS.length],
              topTags: MOCK_TAG_SETS[getMockHash(url) % MOCK_TAG_SETS.length],
            })),
          };
        } else {
          const res = await fetchWithTimeout(`${BASE_URL}/api/links/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: message.urls }),
          });
          data = await res.json();
        }
      }

      else if (type === "TOGGLE_LIKE") {
        console.log("[BG] 좋아요 fetch 시작, url:", message.url);
        if (MOCK_MODE) {
          const url = message.url as string;
          const wasLiked = mockLikedUrls.has(url);
          wasLiked ? mockLikedUrls.delete(url) : mockLikedUrls.add(url);
          const base = MOCK_LIKE_COUNTS[getMockHash(url) % MOCK_LIKE_COUNTS.length];
          data = { success: true, data: { liked: !wasLiked, likeCount: wasLiked ? base : base + 1 } };
        } else {
          // URL 기반 좋아요 토글 (linkId 불필요)
          const res = await fetchWithTimeout(`${BASE_URL}/api/links/likes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: message.url }),
          });
          data = await res.json();
        }
        console.log("[BG] 좋아요 완료:", data);
      }

      // Notion 저장 테스트
      else if (type === "SAVE_TO_NOTION") {
        console.log("[BG] Notion 저장 시작:", message.url);

        const res = await fetchWithTimeout(`${BASE_URL}/api/notion/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: "test-user-1",
            title: message.title,
            url: message.url,
          }),
        });

        data = await res.json();

        console.log("[BG] Notion 저장 완료:", data);
      }

      // Figma PoC - 로컬 Spring 서버로 캡처 요청
      else if (type === "SAVE_TO_FIGMA") {
        console.log("[BG] 메시지 수신 - type=SAVE_TO_FIGMA");
        console.log("[Figma] 캡처 요청:", {
          title: message.title,
          url: message.url,
        });

        const FIGMA_LOCAL_URL = "http://localhost:8080";

        const res = await fetchWithTimeout(
          `${FIGMA_LOCAL_URL}/api/figma/capture`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              userId: "test-user-1",
              title: message.title,
              url: message.url,
            }),
          }
        );

        const body = await res.json();

        if (!res.ok) {
          throw new Error(
            body?.error || `Figma capture failed: ${res.status}`
          );
        }

        data = body;

        console.log("[Figma] 캡처 성공:", body);
        console.log("[Figma] imageUrl:", body.imageUrl);
      } else if (type === "CREATE_REVIEW") {
        console.log("[BG] 리뷰 등록:", message.url);
        if (MOCK_MODE) {
          data = { success: true, data: { id: Date.now(), comment: message.comment } };
        } else {
          const res = await fetchWithTimeout(
            `${BASE_URL}/api/links/reviews`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                url: message.url,
                userId: "test-user-1",
                rating: message.rating ?? 4,
                comment: message.comment,
                tags: message.tags ?? [],
              }),
            }
          );
          data = await res.json();
        }
        console.log("[BG] 리뷰 등록 완료:", data);
      } else if (type === "GET_REVIEWS") {
        console.log("[BG] 리뷰 조회, url:", message.url);
        if (MOCK_MODE) {
          const idx = getMockHash(message.url as string) % MOCK_COMMENTS.length;
          data = {
            success: true,
            data: { content: MOCK_COMMENTS[idx].map((comment, i) => ({ id: i + 1, comment })) },
          };
        } else {
          // URL 기반 리뷰 조회 (linkId 불필요)
          const res = await fetchWithTimeout(
            `${BASE_URL}/api/links/reviews?url=${encodeURIComponent(message.url as string)}`,
            { method: "GET" }
          );
          data = await res.json();
        }
        console.log("[BG] 리뷰 조회 완료:", data);
      } else {
        data = {
          success: false,
          error: "Unknown message type",
        };
      }
    } catch (error) {
      console.error(`[BG] fetch 오류 (${type}):`, String(error));

      data = {
        success: false,
        error: String(error),
      };
    }

    try {
      port.postMessage({
        id,
        data,
      });

      console.log(`[BG] 응답 전송 완료 - id=${id}`);
    } catch (e) {
      console.error("[BG] postMessage 실패 (포트 닫힘):", e);
    }
  });
});
