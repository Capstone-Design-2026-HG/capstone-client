// Saving is explicit so the note can be reviewed before it leaves the browser.
function composeSaveComment(
  destination: string
): Promise<{ comment: string } | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.style.cssText =
      "width:380px;max-width:calc(100vw - 48px);padding:24px;border:1px solid #ddd;border-radius:16px;background:white;color:#111;box-shadow:0 12px 48px #0003;font:14px sans-serif;";
    const heading = document.createElement("h3");
    heading.textContent = `${destination}에 저장`;
    heading.style.cssText = "margin:0 0 12px;font-size:17px;";
    const label = document.createElement("label");
    label.textContent = "함께 남길 코멘트 (선택)";
    const input = document.createElement("textarea");
    input.maxLength = 2000;
    input.rows = 5;
    input.placeholder =
      "저장한 이유, 참고할 부분, 팀에 공유할 의견을 적어보세요.";
    input.style.cssText =
      "display:block;box-sizing:border-box;width:100%;margin-top:8px;padding:12px;border:1px solid #ccc;border-radius:8px;resize:vertical;font:14px sans-serif;background:white;color:#111;";
    label.appendChild(input);
    const count = document.createElement("div");
    count.style.cssText =
      "text-align:right;color:#666;font-size:12px;margin:6px 0 16px;";
    count.textContent = "0 / 2000";
    input.addEventListener("input", () => {
      count.textContent = `${input.value.length} / 2000`;
    });
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:6px;";
    const finish = (value: { comment: string } | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const cancel = document.createElement("button");
    cancel.textContent = "취소";
    cancel.onclick = () => finish(null);
    const save = document.createElement("button");
    save.textContent = "저장하기";
    for (const button of [cancel, save]) {
      button.type = "button";
      button.style.cssText =
        "padding:9px 16px;border:1px solid #ddd;border-radius:8px;cursor:pointer;background:#fff;color:#111;";
    }
    save.style.background = "#2563eb";
    save.style.color = "white";
    save.onclick = () => {
      finish({ comment: input.value.trim() });
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    actions.append(cancel, save);
    dialog.append(heading, label, count, actions);
    document.body.appendChild(dialog);
    dialog.showModal();
    input.focus();
  });
}

// 영구 포트로 background와 통신 (sendMessage 타임아웃 문제 방지)

const pendingCallbacks = new Map<number, (data: unknown) => void>();
let nextMsgId = 0;
let bgPort = chrome.runtime.connect({ name: "capstone-api" });

const setupPort = (port: chrome.runtime.Port) => {
  port.onMessage.addListener((msg: { id: number; data: unknown }) => {
    const cb = pendingCallbacks.get(msg.id);
    if (cb) {
      cb(msg.data);
      pendingCallbacks.delete(msg.id);
    }
  });
  port.onDisconnect.addListener(() => {
    bgPort = chrome.runtime.connect({ name: "capstone-api" });
    setupPort(bgPort);
  });
};
setupPort(bgPort);

const bgCall = (
  message: Record<string, unknown>,
  callback: (data: unknown) => void
) => {
  const id = ++nextMsgId;
  pendingCallbacks.set(id, callback);
  bgPort.postMessage({ id, ...message });
};

// ===== Notion 연결 상태 + 페이지 목록 (모든 링크의 hover 박스가 공유, 최초 1회만 조회) =====
type NotionPage = {
  id: string;
  title: string;
  url: string;
  icon?: string | null;
};
type NotionState =
  | { connected: false }
  | { connected: true; workspaceName?: string | null; pages: NotionPage[] };
type ApiResult<T> = {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  data?: T;
};

// 서버가 "연결 안 됨 / 토큰 만료"로 응답하는 경우 → 연결 버튼 표시
const NOTION_DISCONNECTED_CODES = [
  "NOTION_NOT_CONNECTED",
  "NOTION_UNAUTHORIZED",
];

const bgCallAsync = <T>(message: Record<string, unknown>) =>
  new Promise<ApiResult<T>>((resolve) =>
    bgCall(message, (res) => resolve(res as ApiResult<T>))
  );

const errorMessage = (res: ApiResult<unknown>, fallback: string) =>
  res?.message ?? res?.error ?? fallback;

let notionStatePromise: Promise<NotionState> | null = null;
let notionStateVersion = 0; // 연결/해제 시 증가 → 각 hover 박스가 다시 그리도록

const fetchNotionState = async (): Promise<NotionState> => {
  const conn = await bgCallAsync<{
    connected: boolean;
    workspaceName?: string;
  }>({
    type: "GET_NOTION_CONNECTION",
  });
  if (!conn?.success || !conn.data) {
    throw new Error(
      errorMessage(conn, "Notion 연결 상태를 확인하지 못했습니다.")
    );
  }
  if (!conn.data.connected) return { connected: false };

  const pages = await bgCallAsync<NotionPage[]>({ type: "GET_NOTION_PAGES" });
  if (pages?.success && Array.isArray(pages.data)) {
    return {
      connected: true,
      workspaceName: conn.data.workspaceName,
      pages: pages.data,
    };
  }
  if (pages?.code && NOTION_DISCONNECTED_CODES.includes(pages.code))
    return { connected: false };
  throw new Error(errorMessage(pages, "Notion 페이지를 불러오지 못했습니다."));
};

const loadNotionState = () => {
  if (!notionStatePromise) {
    notionStatePromise = fetchNotionState().catch((err) => {
      notionStatePromise = null; // 실패 시 다음 hover 때 재시도
      throw err;
    });
  }
  return notionStatePromise;
};

const resetNotionState = () => {
  notionStatePromise = null;
  notionStateVersion++;
};

// Notion 인가 팝업을 띄우고, 성공하면 상태를 새로 조회하도록 초기화
const connectNotion = async () => {
  const res = await bgCallAsync<unknown>({ type: "CONNECT_NOTION" });
  if (!res?.success) {
    if (res?.code === "NOTION_OAUTH_CANCELLED") return false;
    throw new Error(errorMessage(res, "Notion 연결에 실패했습니다."));
  }
  resetNotionState();
  return true;
};

type LinkRef = {
  likeCountEl: HTMLSpanElement;
  tagWrapper: HTMLDivElement;
  commentList: HTMLDivElement;
  setInitialState: (isLiked: boolean, count: number) => void;
};
const linkRefMap = new Map<string, LinkRef>();
const urlToLinkId = new Map<string, number>();

const makeTagEl = (tag: string) => {
  const el = document.createElement("span");
  el.innerText = tag;
  el.style.height = "23.33px";
  el.style.padding = "0 8px";
  el.style.boxSizing = "border-box";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.borderRadius = "100px";
  el.style.background = "#FFE8B0";
  el.style.fontSize = "12px";
  el.style.transform = "scaleY(-1)";
  el.style.whiteSpace = "nowrap";
  el.style.wordBreak = "keep-all";
  el.style.flexShrink = "0";
  return el;
};

const titles = document.querySelectorAll("h3");

const urls = Array.from(document.querySelectorAll("h3"))
  .map((title) => title.closest("a")?.href)
  .filter((url): url is string => Boolean(url));

console.log("[EXT] 수집된 URLs:", urls);

titles.forEach((title) => {
  const anchor = title.closest("a");
  if (!anchor) return;

  const parent = anchor.parentElement;
  if (!parent) return;

  if (parent.querySelector(".ext-wrapper")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "ext-wrapper";
  wrapper.style.display = "flex";
  wrapper.style.justifyContent = "space-between";
  wrapper.style.alignItems = "flex-end";
  wrapper.style.width = "100%";
  wrapper.style.position = "relative";

  // 버튼 컨테이너
  const btnContainer = document.createElement("div");
  btnContainer.style.display = "flex";
  btnContainer.style.flexDirection = "column";
  btnContainer.style.alignItems = "flex-end";
  btnContainer.style.gap = "6px";
  btnContainer.style.fontSize = "12px";

  // ===== 좋아요 =====
  const likeBtn = document.createElement("button");
  likeBtn.innerHTML = `
<svg width="17" height="20" viewBox="0 0 17 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
<path d="M10.8336 4.91L10.0772 8H14.4871C14.722 8 14.9536 8.05422 15.1637 8.15836C15.3738 8.2625 15.5565 8.41371 15.6974 8.6C15.8383 8.78629 15.9336 9.00256 15.9756 9.23167C16.0176 9.46078 16.0052 9.69645 15.9395 9.92L14.177 15.92C14.0854 16.2316 13.8942 16.5053 13.6324 16.7C13.3705 16.8947 13.052 17 12.7247 17H2.51286C2.11162 17 1.72682 16.842 1.44311 16.5607C1.15939 16.2794 1 15.8978 1 15.5V9.5C1 9.10218 1.15939 8.72064 1.44311 8.43934C1.72682 8.15804 2.11162 8 2.51286 8H4.60061C4.88206 7.99985 5.15789 7.92186 5.39709 7.77479C5.63629 7.62772 5.82937 7.41741 5.95461 7.1675L8.5643 2C8.92101 2.00438 9.27212 2.08863 9.59138 2.24645C9.91064 2.40427 10.1898 2.63158 10.408 2.9114C10.6262 3.19122 10.7778 3.51632 10.8515 3.8624C10.9252 4.20848 10.9191 4.5666 10.8336 4.91Z" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M4.95834 8.57153V17.143" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
  `;
  likeBtn.style.cursor = "pointer";
  likeBtn.style.backgroundColor = "white";
  likeBtn.style.border = "none";
  likeBtn.style.color = "transparent";
  likeBtn.style.transform = "scaleY(-1)";
  likeBtn.style.display = "flex";
  likeBtn.style.alignItems = "center";
  likeBtn.style.lineHeight = "1";

  const likeCount = document.createElement("span");
  likeCount.innerText = "0";
  likeCount.style.fontSize = "12px";
  likeCount.style.lineHeight = "1";
  likeCount.style.background = "transparent";
  likeCount.style.opacity = "1";
  likeCount.style.transform = "scaleY(-1)";

  let liked = false;
  let currentCount = 0;

  const applyLikeState = (isLiked: boolean, count: number) => {
    liked = isLiked;
    currentCount = count;
    likeCount.innerText = String(count);
    likeBtn.style.color = isLiked ? "black" : "transparent";
  };

  likeBtn.addEventListener("click", (e) => {
    e.stopPropagation();

    const prevLiked = liked;
    const prevCount = currentCount;

    // 낙관적 업데이트: 즉시 UI 반영
    applyLikeState(!prevLiked, prevLiked ? prevCount - 1 : prevCount + 1);

    console.log("[좋아요] 요청 URL:", anchor.href);
    bgCall({ type: "TOGGLE_LIKE", url: anchor.href }, (response) => {
      const res = response as {
        success: boolean;
        data: { liked: boolean; likeCount: number };
      };
      console.log("[좋아요] 응답:", res);
      if (!res?.success) {
        console.warn("[좋아요] 실패 - 롤백. success=false, 응답:", res);
        applyLikeState(prevLiked, prevCount);
        return;
      }
      console.log(
        `[좋아요] 성공 - liked=${res.data.liked}, likeCount=${res.data.likeCount}`
      );
      applyLikeState(res.data.liked, res.data.likeCount);
    });
  });

  const likeWrapper = document.createElement("div");
  likeWrapper.style.display = "flex";
  likeWrapper.style.alignItems = "center";
  likeWrapper.style.gap = "2px";

  likeWrapper.appendChild(likeBtn);
  likeWrapper.appendChild(likeCount);

  // ===== 태그 =====
  const tagWrapper = document.createElement("div");
  tagWrapper.style.display = "flex";
  tagWrapper.style.alignItems = "center";
  tagWrapper.style.gap = "6px";

  // ===== 💬 댓글 =====
  const commentBtn = document.createElement("button");
  commentBtn.innerHTML = `
<svg width="19" height="20" viewBox="0 0 19 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.36844 13.1012C2.48485 13.3662 2.51075 13.6565 2.44286 13.9348L1.59973 16.2847C1.57256 16.404 1.57958 16.5275 1.62013 16.6435C1.66067 16.7595 1.73341 16.8643 1.83142 16.9479C1.92943 17.0315 2.04948 17.091 2.18018 17.121C2.31087 17.1509 2.44789 17.1503 2.57823 17.119L5.28019 16.4062C5.57129 16.3542 5.87277 16.3769 6.15023 16.4719C7.84074 17.1843 9.75577 17.3349 11.5574 16.8975C13.3591 16.46 14.9316 15.4625 15.9975 14.0808C17.0634 12.6992 17.5543 11.0222 17.3834 9.34592C17.2126 7.66959 16.391 6.10157 15.0637 4.91852C13.7363 3.73547 11.9885 3.01342 10.1287 2.87975C8.26878 2.74606 6.41633 3.20937 4.89816 4.18792C3.37998 5.16645 2.29364 6.59735 1.8308 8.22813C1.36797 9.8589 1.55838 11.5848 2.36844 13.1012Z" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
  `;
  commentBtn.style.cursor = "pointer";
  commentBtn.style.backgroundColor = "white";
  commentBtn.style.transform = "scaleY(-1)";

  // ===== notion =====
  const notionBtn = document.createElement("button");
  notionBtn.innerHTML = `
<svg width="19" height="19" viewBox="0 0 19 19" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<rect width="19" height="19" fill="url(#pattern0_69_30)"/>
<defs>
<pattern id="pattern0_69_30" patternContentUnits="objectBoundingBox" width="1" height="1">
<use xlink:href="#image0_69_30" transform="scale(0.01)"/>
</pattern>
<image id="image0_69_30" width="100" height="100" preserveAspectRatio="none" xlink:href="data:image/png;base64,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"/>
</defs>
</svg>
  `;
  notionBtn.style.cursor = "pointer";
  notionBtn.style.backgroundColor = "white";
  notionBtn.style.transform = "scaleY(-1)";

  // 클릭 시 페이지 이동 방지 (저장은 hover 박스에서 페이지 선택으로 수행)
  notionBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // ===== Figma =====
  const figmaBtn = document.createElement("button");
  const figmaIconHtml = `
<svg width="16" height="19" viewBox="0 0 707 833" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M152 634C152 578.772 196.772 534 252 534H352V634C352 689.228 307.228 734 252 734C196.772 734 152 689.228 152 634Z" fill="#24CB71"/>
<path d="M352 134V334H452C507.228 334 552 289.228 552 234C552 178.772 507.228 134 452 134H352Z" fill="#FF7237"/>
<path d="M451.167 534C506.395 534 551.167 489.228 551.167 434C551.167 378.772 506.395 334 451.167 334C395.939 334 351.167 378.772 351.167 434C351.167 489.228 395.939 534 451.167 534Z" fill="#00B6FF"/>
<path d="M152 234C152 289.228 196.772 334 252 334H352V134H252C196.772 134 152 178.772 152 234Z" fill="#FF3737"/>
<path d="M152 434C152 489.228 196.772 534 252 534H352V334H252C196.772 334 152 378.772 152 434Z" fill="#874FFF"/>
</svg>
  `;
  figmaBtn.innerHTML = figmaIconHtml;
  figmaBtn.style.cursor = "pointer";
  figmaBtn.style.backgroundColor = "white";
  figmaBtn.style.border = "none";
  figmaBtn.style.transform = "scaleY(-1)";

  // ===== Figma hover 박스 =====
  const figmaPageBox = document.createElement("div");
  figmaPageBox.style.position = "fixed";
  figmaPageBox.style.width = "240px";
  figmaPageBox.style.background = "white";
  figmaPageBox.style.border = "1px solid #ddd";
  figmaPageBox.style.borderRadius = "10px";
  figmaPageBox.style.display = "none";
  figmaPageBox.style.zIndex = "10000";
  figmaPageBox.style.boxShadow = "0 4px 10px rgba(0,0,0,0.1)";
  figmaPageBox.style.flexDirection = "column";
  figmaPageBox.style.overflow = "hidden";

  const figmaBoxTitle = document.createElement("div");
  figmaBoxTitle.innerText = "저장할 Figma 페이지";
  figmaBoxTitle.style.cssText =
    "font-size:13px;font-weight:600;padding:12px 12px 8px;border-bottom:1px solid #eee;flex-shrink:0;";

  const figmaPageList = document.createElement("div");
  figmaPageList.style.cssText =
    "display:flex;flex-direction:column;padding:8px;gap:4px;max-height:220px;overflow-y:auto;";

  figmaPageBox.appendChild(figmaBoxTitle);
  figmaPageBox.appendChild(figmaPageList);
  document.body.appendChild(figmaPageBox);

  type FigmaFilePage = {
    fileKey: string;
    fileName: string;
    pages: { id: string; name: string }[];
  };
  let figmaStateLoading = false;
  let figmaStateVersion = 0;
  let renderedFigmaVersion = -1;

  const resetFigmaState = () => {
    figmaStateVersion++;
  };

  const setFigmaMessage = (text: string) => {
    figmaPageList.innerHTML = "";
    const msg = document.createElement("div");
    msg.innerText = text;
    msg.style.cssText =
      "color:#888;font-size:12px;padding:6px 4px;line-height:1.5;";
    figmaPageList.appendChild(msg);
  };

  const startConnectFigma = (btn: HTMLButtonElement) => {
    btn.disabled = true;
    btn.innerText = "연결 중...";
    bgCallAsync<{ connected: boolean; userHandle?: string }>({
      type: "CONNECT_FIGMA",
    })
      .then((res) => {
        btn.disabled = false;
        btn.innerText = "Figma 연결하기";
        if (res?.success) {
          resetFigmaState();
          loadFigmaState(true);
        }
      })
      .catch(() => {
        btn.disabled = false;
        btn.innerText = "Figma 연결하기";
      });
  };

  const renderFigmaConnect = () => {
    figmaPageList.innerHTML = "";
    setFigmaMessage(
      "Figma를 연결하면 검색 결과를\n원하는 캔버스에 저장할 수 있어요."
    );
    const connectBtn = document.createElement("button");
    connectBtn.innerText = "Figma 연결하기";
    connectBtn.style.cssText =
      "width:100%;padding:8px;border:none;border-radius:7px;background:#000;color:#fff;font-size:12px;cursor:pointer;margin-top:4px;";
    connectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!connectBtn.disabled) startConnectFigma(connectBtn);
    });
    figmaPageList.appendChild(connectBtn);
  };

  const renderFigmaNoFiles = () => {
    figmaPageList.innerHTML = "";
    setFigmaMessage("팝업에서 Figma 파일 URL을\n추가해주세요.");
  };

  const loadFigmaState = (force = false) => {
    if (!force && renderedFigmaVersion === figmaStateVersion) return;
    if (figmaStateLoading) return;
    renderedFigmaVersion = figmaStateVersion;
    figmaStateLoading = true;
    setFigmaMessage("로딩 중...");

    bgCallAsync<{ connected: boolean }>({ type: "GET_FIGMA_CONNECTION" }).then(
      (connRes) => {
        if (!connRes?.success || !connRes.data?.connected) {
          figmaStateLoading = false;
          renderFigmaConnect();
          return;
        }

        chrome.storage.local.get(["figmaFiles"], (stored) => {
          const storedFiles =
            (stored.figmaFiles as { fileKey: string; fileName: string }[]) ??
            [];
          if (storedFiles.length === 0) {
            figmaStateLoading = false;
            renderFigmaNoFiles();
            return;
          }

          bgCallAsync<FigmaFilePage[]>({
            type: "GET_FIGMA_PAGES",
            files: storedFiles,
          }).then((pagesRes) => {
            figmaStateLoading = false;
            if (!pagesRes?.success) {
              if (
                (pagesRes as Record<string, unknown>)?.code ===
                "FIGMA_NOT_CONNECTED"
              ) {
                renderFigmaConnect();
              } else {
                setFigmaMessage("페이지 목록을 불러오지 못했습니다.");
              }
              return;
            }
            const files = (pagesRes.data as FigmaFilePage[]) ?? [];
            renderFigmaPages(files);
          });
        });
      }
    );
  };

  const renderFigmaPages = (files: FigmaFilePage[]) => {
    figmaPageList.innerHTML = "";
    if (files.length === 0) {
      renderFigmaNoFiles();
      return;
    }
    files.forEach((file) => {
      const fileLabel = document.createElement("div");
      fileLabel.innerText = `📄 ${file.fileName}`;
      fileLabel.style.cssText =
        "font-size:11px;font-weight:600;color:#555;padding:4px 4px 2px;";
      figmaPageList.appendChild(fileLabel);

      file.pages.forEach((page) => {
        const pageBtn = document.createElement("button");
        pageBtn.innerText = page.name;
        pageBtn.style.cssText =
          "display:block;width:100%;text-align:left;padding:7px 10px;border:1px solid #eee;border-radius:7px;font-size:12px;color:#111;background:#fff;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;";
        pageBtn.addEventListener(
          "mouseenter",
          () => (pageBtn.style.background = "#f5f5f5")
        );
        pageBtn.addEventListener(
          "mouseleave",
          () => (pageBtn.style.background = "#fff")
        );

        pageBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pageBtn.disabled) return;

          const title = anchor.querySelector("h3")?.textContent?.trim() ?? "";
          const url = anchor.href;

          const draft = await composeSaveComment(`Figma · ${page.name}`);
          if (draft === null) return;
          const { comment } = draft;
          pageBtn.disabled = true;
          pageBtn.innerText = "⏳ 캡처 중...";

          bgCallAsync<{ imageUrl?: string; error?: string }>({
            type: "SAVE_TO_FIGMA",
            comment,
            title,
            url,
            fileKey: file.fileKey,
            pageNodeId: page.id,
          }).then((res) => {
            if ((res as Record<string, unknown>)?.error || !res) {
              pageBtn.innerText = "✗ 실패";
              pageBtn.style.color = "#e53e3e";
            } else {
              pageBtn.innerText = "✓ 저장됨";
              pageBtn.style.color = "#38a169";
            }
            setTimeout(() => {
              pageBtn.innerText = page.name;
              pageBtn.style.color = "#111";
              pageBtn.disabled = false;
            }, 2000);
          });
        });

        figmaPageList.appendChild(pageBtn);
      });
    });
  };

  let figmaHideTimer: ReturnType<typeof setTimeout> | null = null;

  figmaBtn.addEventListener("mouseenter", () => {
    if (figmaHideTimer) {
      clearTimeout(figmaHideTimer);
      figmaHideTimer = null;
    }
    const rect = figmaBtn.getBoundingClientRect();
    figmaPageBox.style.left = rect.right + 4 + "px";
    figmaPageBox.style.top = rect.top + "px";
    figmaPageBox.style.display = "flex";
    loadFigmaState();
  });

  figmaBtn.addEventListener("mouseleave", () => {
    figmaHideTimer = setTimeout(() => {
      if (!figmaPageBox.matches(":hover")) figmaPageBox.style.display = "none";
    }, 150);
  });

  figmaPageBox.addEventListener("mouseenter", () => {
    if (figmaHideTimer) {
      clearTimeout(figmaHideTimer);
      figmaHideTimer = null;
    }
  });

  figmaPageBox.addEventListener("mouseleave", () => {
    figmaPageBox.style.display = "none";
  });

  figmaBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // ===== 댓글 hover 박스 =====
  const commentBox = document.createElement("div");

  commentBox.style.position = "fixed";
  commentBox.style.width = "220px";
  commentBox.style.height = "260px";
  commentBox.style.background = "white";
  commentBox.style.border = "1px solid #ddd";
  commentBox.style.borderRadius = "10px";
  commentBox.style.display = "none";
  commentBox.style.zIndex = "10000";
  commentBox.style.boxShadow = "0 4px 10px rgba(0,0,0,0.1)";
  commentBox.style.flexDirection = "column";

  // ===== notion hover 박스 =====
  const notionPageBox = document.createElement("div");

  notionPageBox.style.position = "fixed";
  notionPageBox.style.width = "220px";
  notionPageBox.style.height = "260px";
  notionPageBox.style.background = "white";
  notionPageBox.style.border = "1px solid #ddd";
  notionPageBox.style.borderRadius = "10px";
  notionPageBox.style.display = "none";
  notionPageBox.style.zIndex = "10000";
  notionPageBox.style.boxShadow = "0 4px 10px rgba(0,0,0,0.1)";
  notionPageBox.style.flexDirection = "column";

  const notionTitle = document.createElement("div");
  notionTitle.innerText = "저장할 페이지";
  notionTitle.style.fontSize = "13px";
  notionTitle.style.fontWeight = "600";
  notionTitle.style.padding = "12px 12px 8px 12px";
  notionTitle.style.borderBottom = "1px solid #eee";
  notionTitle.style.background = "white";

  const notionList = document.createElement("div");
  notionList.style.display = "flex";
  notionList.style.flexDirection = "column";
  notionList.style.padding = "8px";
  notionList.style.gap = "6px";
  notionList.style.background = "white";
  notionList.style.flex = "1";
  notionList.style.overflowY = "auto";

  const setNotionMessage = (text: string) => {
    notionList.innerHTML = "";
    const msg = document.createElement("div");
    msg.innerText = text;
    msg.style.color = "#888";
    msg.style.fontSize = "12px";
    msg.style.padding = "4px";
    notionList.appendChild(msg);
  };

  // 하단: 연결된 워크스페이스 + 페이지 추가(재연결) 버튼
  const notionFooter = document.createElement("div");
  notionFooter.style.display = "none";
  notionFooter.style.flexShrink = "0";
  notionFooter.style.justifyContent = "space-between";
  notionFooter.style.alignItems = "center";
  notionFooter.style.gap = "6px";
  notionFooter.style.padding = "8px 12px";
  notionFooter.style.borderTop = "1px solid #eee";
  notionFooter.style.fontSize = "11px";
  notionFooter.style.color = "#888";

  const workspaceLabel = document.createElement("span");
  workspaceLabel.style.overflow = "hidden";
  workspaceLabel.style.textOverflow = "ellipsis";
  workspaceLabel.style.whiteSpace = "nowrap";

  const makeTextButton = (text: string) => {
    const btn = document.createElement("button");
    btn.innerText = text;
    btn.style.border = "none";
    btn.style.background = "transparent";
    btn.style.padding = "0";
    btn.style.fontSize = "11px";
    btn.style.color = "#2383e2";
    btn.style.cursor = "pointer";
    btn.style.flexShrink = "0";
    return btn;
  };
  // Notion 인가 화면에서 공유할 페이지를 다시 고르면 목록이 갱신됨
  const reconnectBtn = makeTextButton("페이지 추가");

  notionFooter.appendChild(workspaceLabel);
  notionFooter.appendChild(reconnectBtn);

  let renderedVersion = -1;
  const ensureNotionPages = (force = false) => {
    if (!force && renderedVersion === notionStateVersion) return;
    renderedVersion = notionStateVersion;
    notionFooter.style.display = "none";
    setNotionMessage("로딩중...");
    loadNotionState()
      .then(renderNotionState)
      .catch((err: Error) => {
        renderedVersion = -1; // 다음 hover 때 재시도
        setNotionMessage(err.message);
      });
  };

  const startConnect = (btn: HTMLButtonElement, idleText: string) => {
    btn.disabled = true;
    btn.innerText = "연결 중...";
    connectNotion()
      .then((connected) => {
        btn.disabled = false;
        btn.innerText = idleText;
        if (connected) ensureNotionPages(true);
      })
      .catch((err: Error) => {
        btn.disabled = false;
        btn.innerText = idleText;
        alert(err.message);
      });
  };

  reconnectBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!reconnectBtn.disabled) startConnect(reconnectBtn, "페이지 추가");
  });

  const renderConnectPrompt = () => {
    notionFooter.style.display = "none";
    setNotionMessage(
      "Notion을 연결하면 링크를 원하는 페이지에 저장할 수 있어요."
    );

    const connectBtn = document.createElement("button");
    connectBtn.innerText = "Notion 연결하기";
    connectBtn.style.flexShrink = "0";
    connectBtn.style.padding = "10px";
    connectBtn.style.border = "none";
    connectBtn.style.borderRadius = "8px";
    connectBtn.style.fontSize = "12px";
    connectBtn.style.background = "#000";
    connectBtn.style.color = "#fff";
    connectBtn.style.cursor = "pointer";
    connectBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!connectBtn.disabled) startConnect(connectBtn, "Notion 연결하기");
    });
    notionList.appendChild(connectBtn);
  };

  const saveToNotionPage = async (
    page: NotionPage,
    pageItem: HTMLButtonElement
  ) => {
    const draft = await composeSaveComment(`Notion · ${page.title}`);
    if (draft === null) return;
    const { comment } = draft;
    const label = `${page.icon ? page.icon + " " : ""}${page.title}`;
    const showResult = (text: string, color: string) => {
      pageItem.innerText = text;
      pageItem.style.color = color;
      setTimeout(() => {
        pageItem.innerText = label;
        pageItem.style.color = "#111";
        pageItem.disabled = false;
      }, 2000);
    };

    const title = anchor.querySelector("h3")?.textContent?.trim() ?? "";
    const url = anchor.href;
    console.log("[Notion] 저장 요청:", { pageId: page.id, title, url });

    pageItem.disabled = true;
    pageItem.innerText = "저장 중...";

    bgCallAsync<{
      notionPageUrl: string;
      alreadySaved: boolean;
      databaseCreated: boolean;
      warning?: string;
      topic: string | null;
      relevanceScore: number | null;
    }>({
      type: "SAVE_TO_NOTION",
      comment,
      description: pageDescription(anchor),
      pageId: page.id,
      title,
      url,
    }).then((res) => {
      console.log("[Notion] 저장 응답:", res);

      if (res?.code && NOTION_DISCONNECTED_CODES.includes(res.code)) {
        // 토큰 만료 / Notion에서 연결 해제됨 → 연결 버튼으로 전환
        resetNotionState();
        ensureNotionPages(true);
        return;
      }
      if (!res?.success || !res.data) {
        console.error(
          "[Notion] 저장 실패:",
          errorMessage(res, "알 수 없는 오류")
        );
        showResult("✗ 저장 실패", "#e53e3e");
        return;
      }
      if (res.data.warning) {
        window.alert(res.data.warning);
      }
      const { alreadySaved, topic, relevanceScore } = res.data;
      if (topic != null && relevanceScore != null) {
        pageItem.title = `주제: ${topic} · 관련도 ${relevanceScore}%`;
        showResult(
          alreadySaved
            ? comment
              ? "✓ 코멘트 추가됨"
              : "✓ 이미 저장됨"
            : `✓ 저장됨 · 관련도 ${relevanceScore}%`,
          "#38a169"
        );
      } else {
        pageItem.title = "주제를 설정하면 관련도 정렬이 활성화돼요";
        showResult(
          alreadySaved
            ? comment
              ? "✓ 코멘트 추가됨"
              : "✓ 이미 저장됨"
            : "✓ 저장됨 · 주제 없음",
          "#38a169"
        );
      }
    });
  };

  const renderNotionState = (state: NotionState) => {
    if (!state.connected) {
      renderConnectPrompt();
      return;
    }

    workspaceLabel.innerText = state.workspaceName ?? "Notion";
    notionFooter.style.display = "flex";

    if (state.pages.length === 0) {
      setNotionMessage(
        "선택된 페이지가 없습니다.\n아래 '페이지 추가'에서 저장할 페이지를 선택해주세요."
      );
      return;
    }
    notionList.innerHTML = "";
    state.pages.forEach((page) => {
      const pageItem = document.createElement("button");
      pageItem.innerText = `${page.icon ? page.icon + " " : ""}${page.title}`;
      pageItem.title = page.title;

      pageItem.style.display = "block";
      pageItem.style.width = "100%";
      pageItem.style.flexShrink = "0";
      pageItem.style.padding = "10px";
      pageItem.style.border = "1px solid #eee";
      pageItem.style.borderRadius = "8px";
      pageItem.style.fontSize = "12px";
      pageItem.style.color = "#111";
      pageItem.style.textAlign = "left";
      pageItem.style.whiteSpace = "nowrap";
      pageItem.style.overflow = "hidden";
      pageItem.style.textOverflow = "ellipsis";
      pageItem.style.background = "#fff";
      pageItem.style.cursor = "pointer";

      pageItem.addEventListener(
        "mouseenter",
        () => (pageItem.style.background = "#f5f5f5")
      );
      pageItem.addEventListener(
        "mouseleave",
        () => (pageItem.style.background = "#fff")
      );
      pageItem.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pageItem.disabled) return;
        saveToNotionPage(page, pageItem);
      });

      notionList.appendChild(pageItem);
    });
  };

  notionPageBox.appendChild(notionTitle);
  notionPageBox.appendChild(notionList);
  notionPageBox.appendChild(notionFooter);

  const commentList = document.createElement("div");
  commentList.style.flex = "1";
  commentList.style.overflowY = "auto";
  commentList.style.padding = "10px";
  commentList.style.fontSize = "12px";

  let reviewsLoaded = false;
  commentList.innerHTML = "";
  const bottom = document.createElement("div");

  bottom.style.flexShrink = "0";

  bottom.style.borderTop = "1px solid #eee";
  bottom.style.padding = "8px";
  bottom.style.display = "flex";
  bottom.style.flexDirection = "row";
  bottom.style.gap = "4px";

  const input = document.createElement("input");
  input.placeholder = "댓글 입력...";
  input.style.flex = "1";
  input.style.padding = "6px";
  input.style.fontSize = "12px";
  input.style.border = "1px solid #ccc";
  input.style.borderRadius = "6px";

  input.maxLength = 500;
  const submitBtn = document.createElement("button");
  submitBtn.innerText = "등록";
  submitBtn.style.padding = "6px";
  submitBtn.style.fontSize = "11px";
  submitBtn.style.background = "#000";
  submitBtn.style.color = "#fff";
  submitBtn.style.border = "none";
  submitBtn.style.borderRadius = "6px";
  submitBtn.style.cursor = "pointer";

  const addComment = () => {
    const value = input.value.trim();
    if (!value || submitBtn.disabled) return;
    submitBtn.disabled = true;

    bgCall(
      {
        type: "CREATE_REVIEW",
        url: anchor.href,
        comment: value,
        tags: [],
      },
      (response) => {
        const res = response as { success: boolean; message?: string };
        submitBtn.disabled = false;
        if (!res?.success) {
          window.alert(res?.message ?? "리뷰 등록에 실패했습니다.");
          return;
        }

        const item = document.createElement("div");
        item.style.cssText =
          "display:flex;gap:6px;margin-bottom:6px;align-items:flex-start;";
        const bullet = document.createElement("span");
        bullet.textContent = "•";
        bullet.style.flexShrink = "0";
        const text = document.createElement("span");
        text.textContent = value;
        item.appendChild(bullet);
        item.appendChild(text);
        commentList.appendChild(item);
        input.value = "";
        commentList.scrollTop = commentList.scrollHeight;
        reviewsLoaded = false;
      }
    );
  };

  submitBtn.addEventListener("click", addComment);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addComment();
    }
  });

  commentBtn.style.border = "none";
  notionBtn.style.border = "none";
  likeBtn.style.padding = "0";
  commentBtn.style.padding = "0";
  notionBtn.style.padding = "0";
  figmaBtn.style.padding = "0";

  let commentHideTimer: ReturnType<typeof setTimeout> | null = null;
  let notionHideTimer: ReturnType<typeof setTimeout> | null = null;

  commentBtn.addEventListener("mouseenter", () => {
    if (commentHideTimer) {
      clearTimeout(commentHideTimer);
      commentHideTimer = null;
    }
    const rect = commentBtn.getBoundingClientRect();
    commentBox.style.right = "";
    commentBox.style.left = rect.right + 4 + "px";
    commentBox.style.top = rect.top + "px";
    commentBox.style.display = "flex";

    if (!reviewsLoaded) {
      reviewsLoaded = true;
      commentList.innerHTML =
        '<div style="color:#888;font-size:12px;padding:4px">로딩중...</div>';
      bgCall({ type: "GET_REVIEWS", url: anchor.href }, (response) => {
        const res = response as {
          success: boolean;
          data:
            | { content?: { comment: string; id: number }[] }
            | { comment: string; id: number }[];
        };
        const items = Array.isArray(res.data)
          ? res.data
          : (
              res?.data as
                | { content?: { comment: string; id: number }[] }
                | undefined
            )?.content ?? [];
        if (res?.success && items.length > 0) {
          commentList.replaceChildren();
          for (const review of items) {
            const item = document.createElement("div");
            item.style.cssText =
              "display:flex;gap:6px;margin-bottom:4px;align-items:flex-start;";
            const bullet = document.createElement("span");
            bullet.textContent = "•";
            bullet.style.flexShrink = "0";
            const text = document.createElement("span");
            text.textContent = review.comment;
            item.appendChild(bullet);
            item.appendChild(text);
            commentList.appendChild(item);
          }
        } else {
          commentList.innerHTML =
            '<div style="color:#888;font-size:12px;padding:4px">아직 댓글이 없습니다</div>';
        }
      });
    }
  });

  commentBtn.addEventListener("mouseleave", () => {
    commentHideTimer = setTimeout(() => {
      if (!commentBox.matches(":hover")) commentBox.style.display = "none";
    }, 150);
  });

  commentBox.addEventListener("mouseenter", () => {
    if (commentHideTimer) {
      clearTimeout(commentHideTimer);
      commentHideTimer = null;
    }
  });

  commentBox.addEventListener("mouseleave", () => {
    commentBox.style.display = "none";
  });

  notionBtn.addEventListener("mouseenter", () => {
    if (notionHideTimer) {
      clearTimeout(notionHideTimer);
      notionHideTimer = null;
    }
    const rect = notionBtn.getBoundingClientRect();
    notionPageBox.style.right = "";
    notionPageBox.style.left = rect.right + 4 + "px";
    notionPageBox.style.top = rect.top + "px";
    notionPageBox.style.display = "flex";
    ensureNotionPages();
  });

  notionBtn.addEventListener("mouseleave", () => {
    notionHideTimer = setTimeout(() => {
      if (!notionPageBox.matches(":hover"))
        notionPageBox.style.display = "none";
    }, 150);
  });

  notionPageBox.addEventListener("mouseenter", () => {
    if (notionHideTimer) {
      clearTimeout(notionHideTimer);
      notionHideTimer = null;
    }
  });

  notionPageBox.addEventListener("mouseleave", () => {
    notionPageBox.style.display = "none";
  });

  // ===== 조립 =====
  parent.replaceChild(wrapper, anchor);

  wrapper.appendChild(anchor);
  wrapper.appendChild(btnContainer);
  document.body.appendChild(commentBox);
  document.body.appendChild(notionPageBox);

  bottom.appendChild(input);
  bottom.appendChild(submitBtn);

  commentBox.appendChild(commentList);
  commentBox.appendChild(bottom);

  const row1 = document.createElement("div");
  row1.style.cssText = "display:flex;align-items:center;gap:6px;";
  row1.appendChild(likeWrapper);
  row1.appendChild(tagWrapper);
  row1.appendChild(commentBtn);

  const row2 = document.createElement("div");
  row2.style.cssText = "display:flex;align-items:center;gap:6px;";
  row2.appendChild(figmaBtn);
  row2.appendChild(notionBtn);

  btnContainer.appendChild(row2);
  btnContainer.appendChild(row1);

  linkRefMap.set(anchor.href, {
    likeCountEl: likeCount,
    tagWrapper,
    commentList,
    setInitialState: (isLiked: boolean, count: number) =>
      applyLikeState(isLiked, count),
  });
});

function pageDescription(anchor: HTMLAnchorElement): string {
  const container = anchor.closest(".MjjYud, .g");
  return (container?.querySelector(".VwiC3b, [data-sncf]")?.textContent ?? "")
    .trim()
    .slice(0, 2000);
}

const pageInfo: Record<string, string> = {};
for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a")) {
  if (anchor.querySelector("h3") && urls.includes(anchor.href)) {
    pageInfo[anchor.href] = `${
      anchor.querySelector("h3")?.textContent ?? ""
    } ${pageDescription(anchor)}`.slice(0, 2000);
  }
}
// Respect the server batch limit even when Google shows more than 20 results.
for (let offset = 0; offset < urls.length; offset += 20) {
  const batch = urls.slice(offset, offset + 20);
  bgCall(
    {
      type: "GET_LINK_RATINGS",
      urls: batch,
      pageInfo: Object.fromEntries(
        batch.map((url) => [url, pageInfo[url] ?? ""])
      ),
    },
    (response) => {
      const res = response as {
        success: boolean;
        data?: {
          url: string;
          linkId?: number;
          likeCount: number;
          liked?: boolean;
          categoryTags?: string[];
          topTags?: { name: string; count: number }[];
        }[];
      };
      if (!res?.success || !Array.isArray(res.data)) {
        batch.forEach((url) => {
          const ref = linkRefMap.get(url);
          if (ref) {
            ref.likeCountEl.textContent = "—";
            ref.likeCountEl.title = "사용자 평가를 불러오지 못했습니다.";
          }
        });
        return;
      }
      for (const item of res.data) {
        if (item.linkId !== undefined) urlToLinkId.set(item.url, item.linkId);
        const ref = linkRefMap.get(item.url);
        if (!ref) continue;
        ref.setInitialState(item.liked ?? false, item.likeCount ?? 0);
        ref.tagWrapper.replaceChildren();
        ref.tagWrapper.title = "자동 분류와 평가 기록을 바탕으로 표시되는 태그입니다.";
        const categories = item.categoryTags?.length ? item.categoryTags : ["미분류"];
        const visibleTags = new Set(categories);
        categories.forEach((tag) => ref.tagWrapper.appendChild(makeTagEl(tag)));
        (item.topTags ?? []).slice(0, 2).forEach(({ name }) => {
          if (visibleTags.has(name)) return;
          visibleTags.add(name);
          ref.tagWrapper.appendChild(makeTagEl(name));
        });
      }
    }
  );
}
