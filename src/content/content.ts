const titles = document.querySelectorAll("h3");

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
  btnContainer.style.alignItems = "end";
  btnContainer.style.gap = "6px";
  btnContainer.style.fontSize = "12px";
  btnContainer.style.transform = "scaleX(-1)";

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

  const likeCount = document.createElement("span");
  likeCount.innerText = "11";
  likeCount.style.fontSize = "10px";
  likeCount.style.background = "transparent";
  likeCount.style.opacity = "1";

  let liked = false;

  likeBtn.addEventListener("click", () => {
    liked = !liked;

    if (liked) {
      likeCount.innerText = String(Number(likeCount.innerText) + 1);
      likeBtn.style.color = "black";
    } else {
      likeCount.innerText = String(Number(likeCount.innerText) - 1);
      likeBtn.style.color = "white";
    }
  });

  const likeWrapper = document.createElement("div");
  likeWrapper.style.display = "flex";
  likeWrapper.style.alignItems = "center";

  likeWrapper.appendChild(likeCount);
  likeWrapper.appendChild(likeBtn);

  // ===== 태그 =====
  const tags = ["광고성", "교육", "논문"];

  const tagEls = tags.map((tag) => {
    const el = document.createElement("span");
    el.innerText = tag;
    el.style.padding = "4px 9px";
    el.style.borderRadius = "100px";
    el.style.background = "#FFE8B0";
    el.style.fontSize = "14px";
    return el;
  });

  // ===== 💬 댓글 =====
  const commentBtn = document.createElement("button");
  commentBtn.innerHTML = `
<svg width="19" height="20" viewBox="0 0 19 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.36844 13.1012C2.48485 13.3662 2.51075 13.6565 2.44286 13.9348L1.59973 16.2847C1.57256 16.404 1.57958 16.5275 1.62013 16.6435C1.66067 16.7595 1.73341 16.8643 1.83142 16.9479C1.92943 17.0315 2.04948 17.091 2.18018 17.121C2.31087 17.1509 2.44789 17.1503 2.57823 17.119L5.28019 16.4062C5.57129 16.3542 5.87277 16.3769 6.15023 16.4719C7.84074 17.1843 9.75577 17.3349 11.5574 16.8975C13.3591 16.46 14.9316 15.4625 15.9975 14.0808C17.0634 12.6992 17.5543 11.0222 17.3834 9.34592C17.2126 7.66959 16.391 6.10157 15.0637 4.91852C13.7363 3.73547 11.9885 3.01342 10.1287 2.87975C8.26878 2.74606 6.41633 3.20937 4.89816 4.18792C3.37998 5.16645 2.29364 6.59735 1.8308 8.22813C1.36797 9.8589 1.55838 11.5848 2.36844 13.1012Z" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
  `;
  commentBtn.style.cursor = "pointer";
  commentBtn.style.backgroundColor = "white";

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

  const rightBtnWrapper = document.createElement("div");
  rightBtnWrapper.style.display = "flex";
  rightBtnWrapper.style.flexDirection = "column";

  rightBtnWrapper.appendChild(notionBtn);
  rightBtnWrapper.appendChild(commentBtn);

  // ===== 댓글 hover 박스 =====
  const commentBox = document.createElement("div");

  commentBox.style.position = "absolute";
  commentBox.style.left = "100%";
  commentBox.style.width = "220px";
  commentBox.style.height = "260px";
  commentBox.style.background = "white";
  commentBox.style.border = "1px solid #ddd";
  commentBox.style.borderRadius = "10px";
  commentBox.style.display = "none";
  commentBox.style.zIndex = "10000";
  commentBox.style.boxShadow = "0 4px 10px rgba(0,0,0,0.1)";
  commentBox.style.flexDirection = "column";
  commentBox.style.transform = "scaleY(-1)";

  // ===== 댓글 hover 박스 =====
  const notionPageBox = document.createElement("div");

  notionPageBox.style.position = "absolute";
  notionPageBox.style.left = "100%";
  notionPageBox.style.width = "220px";
  notionPageBox.style.height = "260px";
  notionPageBox.style.background = "white";
  notionPageBox.style.border = "1px solid #ddd";
  notionPageBox.style.borderRadius = "10px";
  notionPageBox.style.display = "none";
  notionPageBox.style.zIndex = "10000";
  notionPageBox.style.boxShadow = "0 4px 10px rgba(0,0,0,0.1)";
  notionPageBox.style.flexDirection = "column";
  notionPageBox.style.transform = "scaleY(-1)";

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

  const notionPages = [
    { name: "프로젝트 자료 정리", url: "https://www.notion.so" },
    { name: "나중에 읽을 링크", url: "https://www.notion.so" },
    { name: "아이디어 수집함", url: "https://www.notion.so" },
  ];

  notionPages.forEach((page) => {
    const pageLink = document.createElement("a");
    pageLink.href = page.url;
    pageLink.target = "_blank";
    pageLink.rel = "noopener noreferrer";
    pageLink.innerText = page.name;

    pageLink.style.display = "block";
    pageLink.style.padding = "10px";
    pageLink.style.border = "1px solid #eee";
    pageLink.style.borderRadius = "8px";
    pageLink.style.fontSize = "12px";
    pageLink.style.color = "#111";
    pageLink.style.textDecoration = "none";
    pageLink.style.background = "#fff";

    notionList.appendChild(pageLink);
  });

  notionPageBox.appendChild(notionTitle);
  notionPageBox.appendChild(notionList);

  const commentList = document.createElement("div");
  commentList.style.flex = "1";
  commentList.style.overflowY = "auto";
  commentList.style.padding = "10px";
  commentList.style.fontSize = "12px";

  commentList.innerHTML = `
    <div>- 이 글 좋다</div>
    <div>- 참고할만함</div>
    <div>- 나중에 읽어야지</div>
  `;
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

  const submitBtn = document.createElement("button");
  submitBtn.innerText = "등록";
  submitBtn.style.padding = "6px";
  submitBtn.style.fontSize = "11px";
  submitBtn.style.background = "#000";
  submitBtn.style.color = "#fff";
  submitBtn.style.border = "none";
  submitBtn.style.borderRadius = "6px";
  submitBtn.style.cursor = "pointer";

  submitBtn.addEventListener("click", () => {
    const value = input.value.trim();
    if (!value) return;

    const item = document.createElement("div");
    item.style.marginBottom = "6px";
    item.innerText = "- " + value;

    commentList.appendChild(item);

    input.value = "";

    // 자동 스크롤 아래로
    commentList.scrollTop = commentList.scrollHeight;
  });

  const addComment = () => {
    const value = input.value.trim();
    if (!value) return;

    const item = document.createElement("div");
    item.style.marginBottom = "6px";
    item.innerText = "- " + value;

    commentList.appendChild(item);
    input.value = "";
    commentList.scrollTop = commentList.scrollHeight;
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

  commentBtn.addEventListener("mouseenter", () => {
    commentBox.style.display = "flex";
  });

  notionBtn.addEventListener("mouseenter", () => {
    notionPageBox.style.display = "block";
  });

  commentBtn.addEventListener("mouseleave", () => {
    setTimeout(() => {
      if (!commentBox.matches(":hover")) {
        commentBox.style.display = "none";
      }
    }, 200);
  });

  notionBtn.addEventListener("mouseleave", () => {
    setTimeout(() => {
      if (!notionPageBox.matches(":hover")) {
        notionPageBox.style.display = "none";
      }
    }, 200);
  });

  commentBox.addEventListener("mouseenter", () => {
    commentBox.style.display = "flex";
  });

  commentBox.addEventListener("mouseleave", () => {
    commentBox.style.display = "none";
  });

  notionPageBox.addEventListener("mouseenter", () => {
    notionPageBox.style.display = "block";
  });

  notionPageBox.addEventListener("mouseleave", () => {
    notionPageBox.style.display = "none";
  });

  // 내부 요소 다시 정상화
  likeBtn.style.transform = "rotate(180deg)";
  likeCount.style.transform = "rotate(180deg)";
  commentBtn.style.transform = "rotate(180deg)";
  notionBtn.style.transform = "rotate(180deg)";
  tagEls.forEach((el) => {
    el.style.transform = "rotate(180deg)";
    el.style.whiteSpace = "nowrap";
    el.style.wordBreak = "keep-all";
    el.style.flexShrink = "0";
  });

  // ===== 조립 =====
  parent.replaceChild(wrapper, anchor);

  wrapper.appendChild(anchor);
  wrapper.appendChild(btnContainer);
  wrapper.appendChild(commentBox);
  wrapper.appendChild(notionPageBox);

  bottom.appendChild(input);
  bottom.appendChild(submitBtn);

  commentBox.appendChild(commentList);
  commentBox.appendChild(bottom);

  btnContainer.appendChild(rightBtnWrapper);
  tagEls.forEach((t) => btnContainer.appendChild(t));
  btnContainer.appendChild(likeWrapper);
});
