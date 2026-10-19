import { useEffect, useState } from "react";
import { type Pairing, parsePairing } from "../ai/paired";
import { pairPhone } from "../ai/state";
import { href } from "../app/router";

// A code works once; React runs effects twice in development, so one attempt per code.
const attempts = new Map<string, Promise<string>>();

export function pairOnce(pairing: Pairing): Promise<string> {
  const key = pairing.code ?? "";
  if (!attempts.has(key)) attempts.set(key, pairPhone(pairing));
  return attempts.get(key)!;
}

// Opened by scanning the Mac's QR code with the phone's camera.
export function PairPage({ payload }: { payload: string }) {
  const [pairing] = useState(() => parsePairing(payload));
  const [mac, setMac] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pairing) return;
    pairOnce(pairing).then(setMac, (failure) => setError(failure instanceof Error ? failure.message : "连接失败"));
  }, []);

  return (
    <main className="page">
      <h1 className="page-title">连接电脑</h1>
      <div className="card stack-16 pair-card">
        {!pairing ? (
          <p>这个二维码看不懂。请在电脑上的 OoFR 里重新点“显示二维码”。</p>
        ) : mac ? (
          <>
            <span className="pill pill-ok">已连接 {mac}</span>
            <p>以后手机上的译文和讲解由这台电脑生成。手机和电脑在同一个 Wi-Fi、电脑上的 OoFR 开着时，就会自动连上。</p>
            <a className="button button-primary" href={href({ name: "today" })}>开始学习</a>
          </>
        ) : error ? (
          <>
            <p className="error-text" role="alert">{error}</p>
            <p className="dim small">请确认电脑上的 OoFR 开着，手机和电脑连的是同一个 Wi-Fi。学校、公司的 Wi-Fi 常常不让设备互连，这时让电脑连手机热点，再在电脑上重新显示二维码。</p>
            <a className="button button-outline" href={href({ name: "me" })}>回到“我的”</a>
          </>
        ) : (
          <p className="thinking" aria-live="polite">正在连接电脑…</p>
        )}
      </div>
    </main>
  );
}
