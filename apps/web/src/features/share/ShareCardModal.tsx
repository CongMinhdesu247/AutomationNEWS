import { useEffect, useRef, useState } from "react";
import {
  calendarDate,
  goldBarItems,
  goldPricePerChi,
  solarToLunarVi,
  type Digest,
  type PublicTodayEdition,
} from "@hub/contracts";
import { Icon } from "../../Icons";

export type ShareCardPayload = {
  solarLabel: string;
  lunarLabel: string;
  specialBadge: string | null;
  weatherLine: string | null;
  aqiLine: string | null;
  sjcValue: string | null;
  usdValue: string | null;
  fuelValue: string | null;
  headlines: Array<{ title: string; source: string }>;
  fileSlug: string;
};

export function buildSharePayloadFromDigest(
  digest: Digest,
  timezone = "Asia/Ho_Chi_Minh",
): ShareCardPayload {
  const created = new Date(digest.createdAt);
  const isoDate = calendarDate(created, timezone);
  const lunar = solarToLunarVi(isoDate);
  const solarLabel = created.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: timezone,
  });

  const s = digest.sources;
  const w = s?.weather?.data;
  const weatherLine = w
    ? `${w.location}: ${w.minTemperature ?? "?"}–${w.maxTemperature ?? "?"}°C · ${w.description}`
    : null;
  const aq = s?.airQuality?.data;
  const aqiLine =
    aq?.usAqi != null
      ? `AQI ${aq.usAqi}${aq.category ? ` (${aq.category})` : ""}`
      : null;

  const gold = s?.gold?.data;
  const bar = gold ? goldBarItems(gold)[0] : undefined;
  const sjcPerChi =
    gold && bar ? goldPricePerChi(bar.sell, gold.unit) : null;
  const sjcValue =
    sjcPerChi != null
      ? `${sjcPerChi.toLocaleString("vi-VN")} đ/chỉ`
      : null;

  const usdValue =
    s?.usd?.data?.sell != null
      ? `${s.usd.data.sell.toLocaleString("vi-VN")} đ`
      : null;

  const fuelItem = s?.fuel?.data?.items[0];
  const fuelValue = fuelItem
    ? `${fuelItem.price.toLocaleString("vi-VN")} đ/lít`
    : null;

  const customHeadlines =
    s?.custom?.data.items.slice(0, 2).map((i) => ({
      title: i.title,
      source: i.source,
    })) ?? [];
  const rssHeadlines =
    s?.rss?.data.items.slice(0, 4).map((i) => ({
      title: i.title,
      source: i.source,
    })) ?? [];
  const headlines = [...customHeadlines, ...rssHeadlines].slice(0, 4);

  return {
    solarLabel,
    lunarLabel: `${lunar.labelShort} · Năm ${lunar.canChiYear}`,
    specialBadge: lunar.specialBadge,
    weatherLine,
    aqiLine,
    sjcValue,
    usdValue,
    fuelValue,
    headlines,
    fileSlug: isoDate,
  };
}

export function buildSharePayloadFromPublicToday(
  edition: PublicTodayEdition,
  cityKey: "hanoi" | "hcmc",
): ShareCardPayload {
  const solarDateObj = new Date(edition.solarDate + "T00:00:00+07:00");
  const solarLabel = solarDateObj.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const city =
    edition.cities.find((c) => c.key === cityKey) ?? edition.cities[0];
  const w = city?.weather;
  const weatherLine = w
    ? `${city.name}: ${w.minTemperature ?? "?"}–${w.maxTemperature ?? "?"}°C · ${w.description}`
    : null;
  const aq = city?.airQuality;
  const aqiLine =
    aq?.usAqi != null
      ? `AQI ${aq.usAqi}${aq.category ? ` (${aq.category})` : ""}`
      : null;

  const gold = edition.markets.gold;
  const bar = gold ? goldBarItems(gold)[0] : undefined;
  const sjcPerChi =
    gold && bar ? goldPricePerChi(bar.sell, gold.unit) : null;
  const sjcValue =
    sjcPerChi != null
      ? `${sjcPerChi.toLocaleString("vi-VN")} đ/chỉ`
      : null;
  const usdValue =
    edition.markets.usd?.sell != null
      ? `${edition.markets.usd.sell.toLocaleString("vi-VN")} đ`
      : null;
  const fuelItem = edition.markets.fuel?.items[0];
  const fuelValue = fuelItem
    ? `${fuelItem.price.toLocaleString("vi-VN")} đ/lít`
    : null;

  return {
    solarLabel,
    lunarLabel: `${edition.lunar.labelShort} · Năm ${edition.lunar.canChiYear}`,
    specialBadge: edition.lunar.specialBadge,
    weatherLine,
    aqiLine,
    sjcValue,
    usdValue,
    fuelValue,
    headlines: edition.articles.slice(0, 4).map((a) => ({
      title: a.title,
      source: a.source,
    })),
    fileSlug: edition.solarDate,
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    const remainingIdx = words.indexOf(current.split(/\s+/)[0] ?? "");
    if (lines.length === maxLines - 1 && remainingIdx >= 0) {
      let tail = current;
      const joinedOriginal = words.join(" ");
      const consumed = [...lines, current].join(" ");
      if (consumed.length < joinedOriginal.length) {
        while (
          tail.length > 4 &&
          ctx.measureText(tail + "…").width > maxWidth
        ) {
          tail = tail.slice(0, -1).trimEnd();
        }
        lines.push(tail + "…");
        return lines;
      }
    }
    lines.push(current);
  }
  return lines.slice(0, maxLines);
}

function renderMorningCardCanvas(
  canvas: HTMLCanvasElement,
  payload: ShareCardPayload,
  shareUrl: string,
) {
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const fontStack =
    '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif';

  // Paper background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#f3f8f5");
  bgGrad.addColorStop(1, "#e6f0eb");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Main editorial card frame
  drawRoundedRect(ctx, 48, 48, W - 96, H - 96, 36);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#cde0d6";
  ctx.stroke();

  // Top emerald banner
  drawRoundedRect(ctx, 84, 84, W - 168, 224, 26);
  const heroGrad = ctx.createLinearGradient(84, 84, W - 84, 308);
  heroGrad.addColorStop(0, "#115e4b");
  heroGrad.addColorStop(1, "#1b7a62");
  ctx.fillStyle = heroGrad;
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = `600 24px ${fontStack}`;
  ctx.fillText("BẢN TIN MỖI SÁNG · ĐIỂM NHANH 2 PHÚT", 124, 144);

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 44px ${fontStack}`;
  const capSolar =
    payload.solarLabel.charAt(0).toUpperCase() + payload.solarLabel.slice(1);
  ctx.fillText(capSolar, 124, 210);

  const lunarLine = payload.specialBadge
    ? `Âm lịch: ${payload.lunarLabel}  •  ${payload.specialBadge}`
    : `Âm lịch: ${payload.lunarLabel}`;
  ctx.fillStyle = "#c7f2dc";
  ctx.font = `600 26px ${fontStack}`;
  ctx.fillText(lunarLine, 124, 264);

  let cursorY = 348;

  // Weather & AQI strip
  if (payload.weatherLine || payload.aqiLine) {
    drawRoundedRect(ctx, 84, cursorY, W - 168, 108, 20);
    ctx.fillStyle = "#f4faf7";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#d5e7de";
    ctx.stroke();

    ctx.fillStyle = "#16382f";
    ctx.font = `600 28px ${fontStack}`;
    const envText = [payload.weatherLine, payload.aqiLine]
      .filter(Boolean)
      .join("   •   ");
    const clippedEnv = wrapLines(ctx, envText, W - 240, 1)[0] ?? envText;
    ctx.fillText(clippedEnv, 120, cursorY + 64);
    cursorY += 136;
  }

  // Market boxes (3 columns)
  const metrics = [
    { label: "VÀNG MIẾNG SJC", value: payload.sjcValue ?? "Đang cập nhật" },
    { label: "USD / VND (VCB)", value: payload.usdValue ?? "Đang cập nhật" },
    { label: "XĂNG RON 95-III", value: payload.fuelValue ?? "Đang cập nhật" },
  ];
  const gap = 20;
  const boxW = Math.floor((W - 168 - gap * 2) / 3);
  metrics.forEach((m, idx) => {
    const bx = 84 + idx * (boxW + gap);
    drawRoundedRect(ctx, bx, cursorY, boxW, 146, 20);
    ctx.fillStyle = "#fbfdfc";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#d5e6dd";
    ctx.stroke();

    ctx.fillStyle = "#527066";
    ctx.font = `600 20px ${fontStack}`;
    ctx.fillText(m.label, bx + 26, cursorY + 52);

    ctx.fillStyle = "#115e4b";
    ctx.font = `700 30px ${fontStack}`;
    const valLine = wrapLines(ctx, m.value, boxW - 52, 1)[0] ?? m.value;
    ctx.fillText(valLine, bx + 26, cursorY + 106);
  });
  cursorY += 186;

  // Section label
  ctx.fillStyle = "#115e4b";
  ctx.font = `700 24px ${fontStack}`;
  ctx.fillText("ĐIỂM TIN ĐÁNG CHÚ Ý SÁNG NAY", 88, cursorY);
  cursorY += 28;

  // Headlines list
  const items = payload.headlines.length
    ? payload.headlines.slice(0, 4)
    : [
        {
          title: "Tổng hợp tin tức chọn lọc, tỷ giá và tiện ích buổi sáng",
          source: "Bản tin mỗi sáng",
        },
      ];

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (cursorY > H - 230) break;

    ctx.fillStyle = "#115e4b";
    ctx.font = `700 28px ${fontStack}`;
    ctx.fillText(`${i + 1}.`, 88, cursorY + 38);

    ctx.fillStyle = "#18332c";
    ctx.font = `600 28px ${fontStack}`;
    const titleLines = wrapLines(ctx, item.title, W - 224, 2);
    titleLines.forEach((line, lineIdx) => {
      ctx.fillText(line, 132, cursorY + 38 + lineIdx * 38);
    });

    const metaY = cursorY + 38 + titleLines.length * 38 + 4;
    ctx.fillStyle = "#627d73";
    ctx.font = `500 22px ${fontStack}`;
    ctx.fillText(item.source, 132, metaY);

    cursorY = metaY + 26;
  }

  // Footer divider + CTA
  ctx.strokeStyle = "#dceae2";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(84, H - 146);
  ctx.lineTo(W - 84, H - 146);
  ctx.stroke();

  ctx.fillStyle = "#1c3b33";
  ctx.font = `600 24px ${fontStack}`;
  ctx.fillText("Đọc trọn vẹn & nhận thông báo sáng miễn phí:", 88, H - 96);

  ctx.fillStyle = "#115e4b";
  ctx.font = `700 24px ${fontStack}`;
  const cleanDisplayUrl = shareUrl.replace(/^https?:\/\//, "");
  ctx.fillText(cleanDisplayUrl, W - 88 - ctx.measureText(cleanDisplayUrl).width, H - 96);
}

export function ShareCardModal({
  open,
  payload,
  onClose,
}: {
  open: boolean;
  payload: ShareCardPayload | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [sharing, setSharing] = useState(false);

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/#/today`
      : "/#/today";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !payload || !canvasRef.current) return;
    renderMorningCardCanvas(canvasRef.current, payload, shareUrl);
    try {
      setPreviewDataUrl(canvasRef.current.toDataURL("image/png"));
    } catch {
      setPreviewDataUrl("");
    }
  }, [open, payload, shareUrl]);

  if (!payload) return null;

  const plainShareText = [
    `Bản tin sáng · ${payload.solarLabel} (${payload.lunarLabel})`,
    payload.weatherLine,
    [
      payload.sjcValue ? `Vàng SJC: ${payload.sjcValue}` : null,
      payload.usdValue ? `USD: ${payload.usdValue}` : null,
      payload.fuelValue ? `RON 95: ${payload.fuelValue}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    ...payload.headlines.slice(0, 3).map((h) => `• ${h.title}`),
    `Đọc ấn bản sáng nay: ${shareUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  async function handleNativeShare() {
    if (!canvasRef.current || !payload) return;
    setSharing(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvasRef.current!.toBlob((b) => resolve(b), "image/png"),
      );
      if (blob && typeof navigator.share === "function") {
        const file = new File(
          [blob],
          `ban-tin-sang-${payload.fileSlug}.png`,
          { type: "image/png" },
        );
        if (
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] })
        ) {
          await navigator.share({
            title: "Bản tin mỗi sáng",
            text: plainShareText,
            files: [file],
          });
          return;
        }
        await navigator.share({
          title: "Bản tin mỗi sáng",
          text: plainShareText,
          url: shareUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(plainShareText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
    } catch {
      // User dismissed share sheet — ignore cleanly.
    } finally {
      setSharing(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Ignore clipboard restriction
    }
  }

  async function handleCopyText() {
    try {
      await navigator.clipboard.writeText(plainShareText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
    } catch {
      // Ignore clipboard restriction
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="sample-digest-dialog share-card-dialog"
      aria-labelledby="share-card-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="sample-digest-sheet share-card-sheet">
        <div className="sample-digest-header">
          <div>
            <span className="section-kicker">Chia sẻ Zalo · Facebook · Nhóm làm việc</span>
            <h2 id="share-card-dialog-title">Thẻ tóm tắt buổi sáng</h2>
          </div>
          <button type="button" onClick={onClose}>
            Đóng
          </button>
        </div>

        <canvas ref={canvasRef} hidden aria-hidden="true" />

        {previewDataUrl && (
          <div className="share-card-preview-frame">
            <img
              src={previewDataUrl}
              alt="Ảnh thẻ tóm tắt bản tin buổi sáng"
              className="share-card-preview-img"
            />
          </div>
        )}

        <div className="share-card-actions">
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button
              type="button"
              className="primary-button"
              disabled={sharing}
              onClick={() => void handleNativeShare()}
            >
              <Icon name="share" size={17} />
              {sharing ? "Đang mở…" : "Gửi nhanh qua Zalo / ứng dụng"}
            </button>
          )}
          {previewDataUrl && (
            <a
              href={previewDataUrl}
              download={`ban-tin-sang-${payload.fileSlug}.png`}
              className="primary-button share-download-link"
            >
              <Icon name="download" size={17} />
              Tải ảnh thẻ (PNG)
            </a>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleCopyLink()}
          >
            <Icon name={copiedLink ? "check" : "copy"} size={16} />
            {copiedLink ? "Đã chép link #/today" : "Sao chép link công khai"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleCopyText()}
          >
            <Icon name={copiedText ? "check" : "copy"} size={16} />
            {copiedText ? "Đã chép tóm tắt" : "Chép nội dung chữ"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
