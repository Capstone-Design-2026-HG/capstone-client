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

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
    console.warn("[BG] fetch 타임아웃:", url);
  }, timeoutMs);

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

// 익스텐션 사용자 식별용 UUID (최초 1회 생성 후 storage에 보관)
const getUserId = async () => {
  const stored = await chrome.storage.local.get("userId");
  if (typeof stored.userId === "string") return stored.userId;
  const userId = crypto.randomUUID();
  await chrome.storage.local.set({ userId });
  return userId;
};

// Notion OAuth: 인가 페이지 팝업 → code 수신 → 서버에서 토큰 교환
const connectNotion = async () => {
  const userId = await getUserId();
  const redirectUri = chrome.identity.getRedirectURL(); // https://<ext-id>.chromiumapp.org/
  const state = crypto.randomUUID();

  const urlRes = await fetchWithTimeout(
    `${BASE_URL}/api/notion/oauth/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}&state=${state}`,
    { method: "GET" }
  );
  const urlBody = await urlRes.json();
  if (!urlBody?.success) return urlBody;

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: urlBody.data.authorizeUrl,
      interactive: true,
    });
  } catch (e) {
    // 사용자가 팝업을 닫은 경우 등
    return { success: false, code: "NOTION_OAUTH_CANCELLED", message: "Notion 연결이 취소되었습니다.", error: String(e) };
  }

  const params = new URL(responseUrl ?? "").searchParams;
  if (params.get("state") !== state) {
    return { success: false, message: "Notion 연결 검증에 실패했습니다. 다시 시도해주세요." };
  }
  const code = params.get("code");
  if (!code) {
    return { success: false, code: "NOTION_OAUTH_CANCELLED", message: "Notion 연결이 취소되었습니다." };
  }

  const tokenRes = await fetchWithTimeout(`${BASE_URL}/api/notion/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, code, redirectUri }),
  });
  return tokenRes.json();
};

// Figma OAuth: 인가 페이지 팝업 → code 수신 → 서버에서 토큰 교환
// 팝업은 launchWebAuthFlow 중 닫히므로 결과를 storage에도 저장
const connectFigma = async () => {
  const userId = await getUserId();
  const redirectUri = chrome.identity.getRedirectURL();
  const state = crypto.randomUUID();

  console.log("[Figma] OAuth 시작, redirectUri:", redirectUri);

  const urlRes = await fetchWithTimeout(
    `${BASE_URL}/api/figma/oauth/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}&state=${state}`,
    { method: "GET" }
  );
  const urlBody = await urlRes.json();
  if (!urlBody?.success) return urlBody;

  console.log("[Figma] authorizeUrl:", urlBody.data?.authorizeUrl);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: urlBody.data.authorizeUrl,
      interactive: true,
    });
  } catch (e) {
    console.error("[Figma] launchWebAuthFlow 실패:", String(e));
    const result = { success: false, code: "FIGMA_OAUTH_CANCELLED", message: "Figma 연결이 취소되었습니다.", error: String(e) };
    await chrome.storage.local.set({ figmaOAuthResult: result });
    return result;
  }

  console.log("[Figma] responseUrl:", responseUrl);

  const params = new URL(responseUrl ?? "").searchParams;
  if (params.get("state") !== state) {
    return { success: false, message: "Figma 연결 검증에 실패했습니다. 다시 시도해주세요." };
  }
  const code = params.get("code");
  if (!code) {
    return { success: false, code: "FIGMA_OAUTH_CANCELLED", message: "Figma 연결이 취소되었습니다." };
  }

  const tokenRes = await fetchWithTimeout(`${BASE_URL}/api/figma/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, code, redirectUri }),
  });
  const result = await tokenRes.json();
  // 팝업이 닫혀있어도 다시 열 때 연결 완료 확인 가능
  await chrome.storage.local.set({ figmaOAuthResult: result });
  console.log("[Figma] OAuth 완료:", result);
  return result;
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
          const userId = await getUserId();
          const res = await fetchWithTimeout(`${BASE_URL}/api/links/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: message.urls, userId, pageInfo: message.pageInfo }),
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
          const userId = await getUserId();
          const res = await fetchWithTimeout(`${BASE_URL}/api/links/likes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: message.url, userId }),
          });
          data = await res.json();
        }
        console.log("[BG] 좋아요 완료:", data);
      }

      else if (type === "GET_NOTION_CONNECTION") {
        const userId = await getUserId();
        const res = await fetchWithTimeout(
          `${BASE_URL}/api/notion/connection?userId=${userId}`,
          { method: "GET" }
        );
        data = await res.json();
        console.log("[BG] Notion 연결 상태:", data);
      }

      else if (type === "CONNECT_NOTION") {
        console.log("[BG] Notion 연결 시작");
        data = await connectNotion();
        console.log("[BG] Notion 연결 결과:", data);
      }

      else if (type === "GET_NOTION_PAGES") {
        console.log("[BG] Notion 페이지 목록 조회");
        const userId = await getUserId();
        const res = await fetchWithTimeout(
          `${BASE_URL}/api/notion/pages?userId=${userId}`,
          { method: "GET" }
        );
        data = await res.json();
        console.log("[BG] Notion 페이지 목록 조회 완료:", data);
      }

      else if (type === "SAVE_TO_NOTION") {
        console.log("[BG] Notion 저장 시작:", message.pageId, message.url);

        const res = await fetchWithTimeout(`${BASE_URL}/api/notion/save`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: await getUserId(),
            pageId: message.pageId,
            description: message.description,
            comment: message.comment,
            selectedText: message.selectedText,
            imageBase64: message.imageBase64,
            captureKind: message.captureKind,
            title: message.title,
            url: message.url,
          }),
        }, 60000);

        data = await res.json();

        console.log("[BG] Notion 저장 완료:", data);
      }

      else if (type === "CAPTURE_CURRENT_PAGE") {
        const tab = port.sender?.tab;
        if (!tab?.id || tab.windowId === undefined) throw new Error("현재 탭을 확인할 수 없습니다.");
        const active = await chrome.tabs.query({active: true, windowId: tab.windowId});
        if (active[0]?.id !== tab.id) throw new Error("캡처할 탭을 먼저 활성화해 주세요.");
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {format: "png"});
        data = {success: true, data: {imageBase64: dataUrl.split(",")[1]}};
      }
      else if (type === "CAPTURE_FULL_IN_NEW_TAB") {
        const sourceId = port.sender?.tab?.id;
        if (!sourceId) throw new Error("현재 페이지를 확인할 수 없습니다.");
        const source = await chrome.tabs.get(sourceId);
        if (source.windowId === undefined || !source.url) throw new Error("현재 페이지를 확인할 수 없습니다.");
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("이 페이지는 전체 캡처를 지원하지 않습니다.");
        const temporary = await chrome.tabs.create({url: url.href, windowId: source.windowId, active: false});
        if (temporary.id === undefined) throw new Error("캡처용 탭을 열 수 없습니다.");
        const tabId = temporary.id, target = {tabId};
        let attached = false;
        try {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(updated); chrome.tabs.onRemoved.removeListener(removed); error ? reject(error) : resolve(); };
            const updated = (id: number, info: {status?: string}) => { if (id === tabId && info.status === 'complete') finish(); };
            const removed = (id: number) => { if (id === tabId) finish(new Error('캡처용 탭이 닫혔습니다.')); };
            const timeout = setTimeout(() => finish(new Error('캡처할 페이지를 불러오지 못했습니다.')), 30000);
            chrome.tabs.onUpdated.addListener(updated); chrome.tabs.onRemoved.addListener(removed);
            chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(); }).catch(() => finish(new Error('캡처용 탭을 확인할 수 없습니다.')));
          });
          await new Promise(resolve => setTimeout(resolve, 1200));
          await chrome.scripting.executeScript({target, func: () => { const toolbar = document.getElementById('search-rating-toolbar'); if (toolbar) toolbar.style.setProperty('visibility', 'hidden', 'important'); }});
          await chrome.debugger.attach(target, '1.3'); attached = true;
          await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
            width: Math.max(320, Math.min(1600, source.width || 1440)), height: Math.max(300, Math.min(1200, source.height || 900)), deviceScaleFactor: 1, mobile: false
          });
          await new Promise(resolve => setTimeout(resolve, 500));
          const metrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics') as {cssContentSize: {width: number; height: number}};
          const width = Math.ceil(metrics.cssContentSize.width), height = Math.ceil(metrics.cssContentSize.height);
          if (!width || !height || width > 16000 || height > 30000 || width * height > 60_000_000) throw new Error('페이지가 너무 커서 전체 캡처할 수 없습니다. 필요한 영역을 선택해 주세요.');
          const screenshot = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true, clip: {x: 0, y: 0, width, height, scale: 1}
          }) as {data: string};
          if (!screenshot?.data) throw new Error('전체 페이지를 캡처하지 못했습니다.');
          data = {success: true, data: {imageBase64: screenshot.data}};
        } finally {
          if (attached) await chrome.debugger.detach(target).catch(() => {});
          await chrome.tabs.remove(tabId).catch(() => {});
        }
      }
      else if (type === "SAVE_CURRENT_TO_FIGMA") {
        const res = await fetchWithTimeout(`${BASE_URL}/api/figma/capture`, {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({userId: await getUserId(), title: message.title, url: message.url,
            comment: message.comment, imageBase64: message.imageBase64,
            fileKey: message.fileKey, pageNodeId: message.pageNodeId}),
        }, 60000);
        const body = await res.json();
        data = res.ok ? {success: true, data: body} : {success: false, message: body?.message ?? body?.error ?? "Figma 저장에 실패했습니다."};
      }
      else if (type === "GET_FIGMA_CONNECTION") {
        const userId = await getUserId();
        const res = await fetchWithTimeout(
          `${BASE_URL}/api/figma/connection?userId=${userId}`,
          { method: "GET" }
        );
        data = await res.json();
      }

      else if (type === "CONNECT_FIGMA") {
        data = await connectFigma();
      }

      else if (type === "GET_FIGMA_PAGES") {
        const userId = await getUserId();
        const figmaFiles = (message.files as { fileKey: string; fileName: string }[]) ?? [];

        if (figmaFiles.length === 0) {
          data = { success: false, code: "FIGMA_NOT_CONFIGURED" };
        } else {
          const res = await fetchWithTimeout(`${BASE_URL}/api/figma/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, files: figmaFiles }),
          });
          data = await res.json();
        }
      }

      // Extension에서 CDP로 전체 페이지 캡처 후 서버로 전송
      else if (type === "SAVE_TO_FIGMA") {
        console.log("[Figma] 캡처 요청:", { title: message.title, url: message.url });

        const userId = await getUserId();
        const targetUrl = message.url as string;
        const title = (message.title as string) || "";

        // 백그라운드 탭 열기
        const tab = await chrome.tabs.create({ url: targetUrl, active: false });
        const tabId = tab.id!;

        try {
          // 탭 로딩 완료 대기 (최대 30초)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error("페이지 로딩 타임아웃 (30초)"));
            }, 30000);

            const listener = (id: number, info: { status?: string }) => {
              if (id === tabId && info.status === "complete") {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });

          // JS/CSS 렌더링 대기
          await new Promise((r) => setTimeout(r, 1500));

          // CDP 연결
          await chrome.debugger.attach({ tabId }, "1.3");

          // 데스크탑 1440px 너비로 viewport 강제 설정 후 재렌더링
          await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
            width: 1440,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await new Promise((r) => setTimeout(r, 800));

          // 전체 페이지 크기 측정
          const metrics = (await chrome.debugger.sendCommand(
            { tabId },
            "Page.getLayoutMetrics"
          )) as { cssContentSize: { width: number; height: number } };

          const pageWidth = Math.ceil(metrics.cssContentSize.width);
          // scale 1.0 고정(너비 1440px 유지), 4096px 초과 시 잘림
          const pageHeight = Math.min(Math.ceil(metrics.cssContentSize.height), 4096);

          console.log("[Figma] 페이지 크기:", pageWidth, "x", pageHeight);

          const screenshot = (await chrome.debugger.sendCommand(
            { tabId },
            "Page.captureScreenshot",
            {
              format: "png",
              captureBeyondViewport: true,
              clip: { x: 0, y: 0, width: pageWidth, height: pageHeight, scale: 1.0 },
            }
          )) as { data: string };

          await chrome.debugger.detach({ tabId });

          console.log("[Figma] 스크린샷 완료, 서버 전송 중...");

          // 서버로 base64 이미지 전송 (서버가 Figma API 호출)
          const res = await fetchWithTimeout(`${BASE_URL}/api/figma/capture`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              title,
              url: targetUrl,
              comment: message.comment,
              imageBase64: screenshot.data,
              fileKey: (message.fileKey as string) ?? null,
              pageNodeId: (message.pageNodeId as string) ?? null,
            }),
          });

          const body = await res.json();
          if (!res.ok) {
            throw new Error(body?.error || `Figma save failed: ${res.status}`);
          }

          data = body;
          console.log("[Figma] 저장 완료:", body);

        } finally {
          // CDP 연결 해제 및 탭 정리
          try { await chrome.debugger.detach({ tabId }); } catch {}
          chrome.tabs.remove(tabId).catch(() => {});
        }
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
                userToken: await getUserId(),
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
