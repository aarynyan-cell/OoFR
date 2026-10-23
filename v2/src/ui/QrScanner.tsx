import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

// The camera needs a secure page (https or the home-screen app).
export function canScan(): boolean {
  return window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
}

// Reads a QR code with the camera; calls onText with each code it sees until closed.
export function QrScanner({ onText, onClose }: { onText: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const report = useRef(onText);
  report.current = onText;
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    void (async () => {
      try {
        const [{ default: jsQR }, media] = await Promise.all([
          import("jsqr"),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
        ]);
        stream = media;
        if (stopped || !video.current) return;
        video.current.srcObject = media;
        await video.current.play();
        const scan = () => {
          if (stopped || !video.current || !context) return;
          const { videoWidth, videoHeight } = video.current;
          if (videoWidth) {
            // A smaller copy reads just as well and keeps older phones cool.
            const scale = Math.min(1, 640 / videoWidth);
            canvas.width = Math.round(videoWidth * scale);
            canvas.height = Math.round(videoHeight * scale);
            context.drawImage(video.current, 0, 0, canvas.width, canvas.height);
            const code = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
            if (code?.data) report.current(code.data);
          }
          frame = requestAnimationFrame(scan);
        };
        frame = requestAnimationFrame(scan);
      } catch (failure) {
        const name = failure instanceof DOMException ? failure.name : "";
        setError(name === "NotAllowedError" ? "没有相机权限：请在系统设置里允许 OoFR 使用相机，或者用手机相机直接扫码。" : "打不开相机，可以用手机相机直接扫码。");
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <Modal title="扫码连接电脑" onClose={onClose}>
      <div className="stack-16">
        <h2 className="sheet-title">扫码连接电脑</h2>
        {error ? <p className="error-text">{error}</p> : <video ref={video} className="scanner-video" playsInline muted aria-label="相机画面" />}
        <p className="dim small">对准电脑上 OoFR 显示的二维码（我的 → AI 翻译与讲解 → 连接手机）。</p>
        <button type="button" className="button button-outline" onClick={onClose}>取消</button>
      </div>
    </Modal>
  );
}
