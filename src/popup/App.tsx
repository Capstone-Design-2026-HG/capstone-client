import { useEffect, useState } from "react";

type FigmaFile = { fileKey: string; fileName: string };
type FigmaState =
  | { connected: false }
  | { connected: true; userHandle: string };

const bgCall = (message: Record<string, unknown>): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "capstone-api" });
    const id = Date.now();
    port.onMessage.addListener((msg: { id: number; data: unknown }) => {
      if (msg.id === id) {
        port.disconnect();
        resolve(msg.data as Record<string, unknown>);
      }
    });
    port.postMessage({ id, ...message });
  });

export default function App() {
  const [figmaState, setFigmaState] = useState<FigmaState>({ connected: false });
  const [files, setFiles] = useState<FigmaFile[]>([]);
  const [fileUrl, setFileUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    chrome.storage.local.get(["figmaFiles", "figmaOAuthResult"], (data) => {
      if (data.figmaFiles) setFiles(data.figmaFiles as FigmaFile[]);
      // 팝업이 닫혀있던 동안 OAuth가 완료/실패했을 때 결과 표시
      if (data.figmaOAuthResult) {
        const r = data.figmaOAuthResult as Record<string, unknown>;
        if (!r.success) {
          setMsg(`✗ ${(r.message as string) ?? "Figma 연결 실패"}${r.error ? `\n${r.error}` : ""}`);
        }
        chrome.storage.local.remove("figmaOAuthResult");
      }
    });
    bgCall({ type: "GET_FIGMA_CONNECTION" }).then((res) => {
      const d = res?.data as { connected: boolean; userHandle?: string } | undefined;
      if (d?.connected) setFigmaState({ connected: true, userHandle: d.userHandle ?? "" });
    });
  }, []);

  const connectFigma = async () => {
    setLoading(true);
    setMsg("");
    try {
      const res = await bgCall({ type: "CONNECT_FIGMA" });
      if (!res?.success) {
        const errDetail = (res as Record<string, unknown>)?.error as string | undefined;
        throw new Error((res?.message as string) ?? `Figma 연결 실패${errDetail ? `: ${errDetail}` : ""}`);
      }
      const d = (res?.data as { connected: boolean; userHandle?: string }) ?? {};
      setFigmaState({ connected: true, userHandle: d.userHandle ?? "" });
      setMsg("✓ Figma 연결 완료!");
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoading(false);
    }
  };

  const disconnectFigma = async () => {
    await bgCall({ type: "CONNECT_FIGMA" }); // will be replaced when we add DISCONNECT
    chrome.storage.local.remove(["figmaFiles"]);
    setFiles([]);
    setFigmaState({ connected: false });
    setMsg("Figma 연결이 해제되었습니다.");
  };

  const addFile = async () => {
    const match = fileUrl.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]+)/);
    if (!match) {
      setMsg("✗ 올바른 Figma 파일 URL을 입력하세요.");
      return;
    }
    const fileKey = match[1];
    if (files.find((f) => f.fileKey === fileKey)) {
      setMsg("이미 추가된 파일입니다.");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const res = await bgCall({
        type: "GET_FIGMA_PAGES",
        files: [{ fileKey, fileName: "" }],
      });
      const fileData = (res?.data as { fileKey: string; fileName: string }[])?.[0];
      const fileName = fileData?.fileName || fileKey;
      const newFiles = [...files, { fileKey, fileName }];
      setFiles(newFiles);
      await chrome.storage.local.set({ figmaFiles: newFiles });
      setFileUrl("");
      setMsg(`✓ "${fileName}" 추가됨`);
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setLoading(false);
    }
  };

  const removeFile = async (fileKey: string) => {
    const newFiles = files.filter((f) => f.fileKey !== fileKey);
    setFiles(newFiles);
    await chrome.storage.local.set({ figmaFiles: newFiles });
  };

  return (
    <div style={{ width: 300, padding: 20, fontFamily: "-apple-system, sans-serif", fontSize: 13 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Figma 설정</h2>

      {!figmaState.connected ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: "#666", marginBottom: 10, lineHeight: 1.5 }}>
            Figma를 연결하면 검색 결과 스크린샷을 원하는 캔버스에 바로 저장할 수 있습니다.
          </p>
          <button onClick={connectFigma} disabled={loading} style={primaryBtn}>
            {loading ? "연결 중..." : "Figma 연결하기"}
          </button>
        </div>
      ) : (
        <div>
          <div style={connectedBadge}>
            <span>✓ {figmaState.userHandle}</span>
            <button
              onClick={disconnectFigma}
              style={{ border: "none", background: "none", color: "#aaa", cursor: "pointer", fontSize: 11 }}
            >
              연결 해제
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>Figma 파일 URL 추가</div>
            <input
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://www.figma.com/file/..."
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && addFile()}
            />
            <button onClick={addFile} disabled={loading || !fileUrl} style={primaryBtn}>
              {loading ? "불러오는 중..." : "추가"}
            </button>
          </div>

          {files.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>연결된 파일</div>
              {files.map((f) => (
                <div key={f.fileKey} style={fileItemStyle}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📄 {f.fileName}
                  </span>
                  <button
                    onClick={() => removeFile(f.fileKey)}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "#aaa", fontSize: 14, flexShrink: 0 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 12, color: msg.startsWith("✓") ? "#38a169" : msg.startsWith("✗") ? "#e53e3e" : "#666", marginTop: 4 }}>
          {msg}
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  background: "#111",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  fontSize: 12,
  cursor: "pointer",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  border: "1px solid #ddd",
  borderRadius: 7,
  fontSize: 12,
  marginBottom: 6,
  boxSizing: "border-box",
};

const fileItemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "7px 10px",
  border: "1px solid #eee",
  borderRadius: 7,
  marginBottom: 5,
  fontSize: 12,
  gap: 8,
};

const connectedBadge: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 12px",
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  borderRadius: 8,
  marginBottom: 14,
  fontSize: 12,
  color: "#166534",
};
