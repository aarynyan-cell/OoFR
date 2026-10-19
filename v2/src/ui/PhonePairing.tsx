import { useEffect, useState } from "react";
import { tauri } from "../ai/backend";
import { PHONE_URL } from "../ai/paired";

interface Device {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
}

// Dark modules as one path: a run of dark cells in a row is one rectangle.
export function qrPath(rows: string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    for (const match of row.matchAll(/1+/g)) parts.push(`M${(match.index ?? 0) + 4} ${y + 4}h${match[0].length}v1h-${match[0].length}z`);
  });
  return parts.join("");
}

export function QrCode({ rows, label }: { rows: string[]; label: string }) {
  const size = rows.length + 8;
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(rows)} fill="#000" />
    </svg>
  );
}

const when = (seconds: number) => new Date(seconds * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

// Mac app only: shows the QR code a phone scans to use this Mac's AI.
export function PhonePairing() {
  const app = tauri();
  const [devices, setDevices] = useState<Device[]>([]);
  const [rows, setRows] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void app?.core.invoke<Device[]>("pair_devices").then(setDevices, () => undefined);
  }, []);

  if (!app) return null;

  const show = async () => {
    setError("");
    try {
      const info = await app.core.invoke<{ payload: string; devices: Device[] }>("pair_info");
      setDevices(info.devices);
      setRows(await app.core.invoke<string[]>("qr_rows", { text: `${PHONE_URL}#/pair/${info.payload}` }));
    } catch (failure) {
      setError(typeof failure === "string" ? failure : "无法显示二维码");
    }
  };

  const forget = async (device: Device) => {
    setDevices(await app.core.invoke<Device[]>("pair_forget", { id: device.id }));
  };

  return (
    <section className="stack-10">
      <h3 className="sheet-subtitle">连接手机</h3>
      <p className="dim small">手机上的译文和讲解也由这台电脑生成。手机和电脑连同一个 Wi-Fi，用手机上的 OoFR（我的 → 本机 AI）或相机扫码。学校、公司的 Wi-Fi 常常不让设备互连，这时让电脑连手机热点。</p>
      {rows ? (
        <div className="stack-6 qr-box">
          <QrCode rows={rows} label="连接手机的二维码" />
          <p className="dim small">二维码 10 分钟内有效，扫一次配对一部手机。</p>
        </div>
      ) : (
        <button type="button" className="button button-outline" onClick={() => void show()}>显示二维码</button>
      )}
      {devices.length > 0 && (
        <ul className="stack-6 device-list">
          {devices.map((device) => (
            <li key={device.id} className="device-row">
              <span className="grow stack-2">
                <span>{device.name}</span>
                <span className="dim small">配对于 {when(device.pairedAt)} · 上次连接 {when(device.lastSeen)}</span>
              </span>
              <button type="button" className="button button-small button-outline" onClick={() => void forget(device)}>移除</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </section>
  );
}
