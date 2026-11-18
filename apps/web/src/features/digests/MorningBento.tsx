import {
  goldBarItems,
  goldPricePerChi,
  type DigestSources,
} from "@hub/contracts";
import { Icon } from "../../Icons";
import { weatherVisual } from "../../lib/format";
import { Sparkline } from "./Sparkline";

function aqiTone(aqi: number | null | undefined): string {
  if (aqi == null) return "neutral";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  return "elevated";
}

function uvTone(uv: number | null | undefined): string {
  if (uv == null) return "neutral";
  if (uv < 3) return "good";
  if (uv < 6) return "moderate";
  return "elevated";
}

export function MorningBento({
  sources,
  sparklines,
  onJump,
}: {
  sources: DigestSources;
  sparklines?: { sjc: number[]; usd: number[] } | null;
  onJump?: (sectionId: string) => void;
}) {
  const weather =
    sources.weather.status !== "disabled" ? sources.weather.data : null;
  const air =
    sources.airQuality && sources.airQuality.status !== "disabled"
      ? sources.airQuality.data
      : null;
  const uv =
    sources.uv && sources.uv.status !== "disabled" ? sources.uv.data : null;
  const gold =
    sources.gold && sources.gold.status !== "disabled"
      ? sources.gold.data
      : null;
  const goldBar = gold ? goldBarItems(gold)[0] : undefined;
  const usd =
    sources.usd && sources.usd.status !== "disabled" ? sources.usd.data : null;
  const fuel =
    sources.fuel && sources.fuel.status !== "disabled"
      ? sources.fuel.data?.items[0]
      : undefined;

  const hasSky = Boolean(weather || air || uv);
  const hasMarket = Boolean(goldBar || usd || fuel);
  if (!hasSky && !hasMarket) return null;

  const temps = [
    ...new Set([weather?.minTemperature, weather?.maxTemperature]),
  ].filter((v): v is number => v != null);
  const skyVisual = weatherVisual(weather?.weatherCode);

  return (
    <div className="morning-bento" aria-label="Bức tranh sáng nay">
      {hasSky && (
        <article className="bento-card bento-sky">
          <div className="bento-card-header">
            <span className="bento-kicker">Bầu trời &amp; Môi trường</span>
            {weather?.location && (
              <span className="bento-location">{weather.location}</span>
            )}
          </div>
          {weather ? (
            <div className="bento-weather-hero">
              <span className={"bento-weather-icon tone-" + skyVisual.tone}>
                <Icon name={skyVisual.icon} size={26} />
              </span>
              <div>
                <strong className="bento-temp">
                  {temps.length ? `${temps.join("–")}°C` : "—"}
                </strong>
                <span className="bento-desc">{weather.description}</span>
              </div>
              {weather.umbrella && (
                <span className="bento-umbrella-pill">Nhớ mang ô</span>
              )}
            </div>
          ) : null}

          {weather?.rainProbability != null && (
            <div className="bento-rain-meter">
              <div className="bento-rain-labels">
                <span>Khả năng mưa trong ngày</span>
                <strong>{weather.rainProbability}%</strong>
              </div>
              <div className="bento-progress-track" aria-hidden="true">
                <span
                  style={{
                    width: `${Math.min(100, Math.max(0, weather.rainProbability))}%`,
                  }}
                />
              </div>
            </div>
          )}

          {(air || uv) && (
            <div className="bento-env-pills">
              {air && (
                <button
                  type="button"
                  className={"bento-env-chip aqi-" + aqiTone(air.usAqi)}
                  onClick={() => onJump?.("section-air")}
                >
                  <span>AQI Mỹ</span>
                  <strong>{air.usAqi ?? "—"}</strong>
                  {air.category && <small>{air.category}</small>}
                </button>
              )}
              {uv && (
                <button
                  type="button"
                  className={"bento-env-chip aqi-" + uvTone(uv.maximum)}
                  onClick={() => onJump?.("section-utilities")}
                >
                  <span>Chỉ số UV</span>
                  <strong>
                    {uv.maximum.toLocaleString("vi-VN", {
                      maximumFractionDigits: 1,
                    })}
                  </strong>
                  <small>{uv.level}</small>
                </button>
              )}
            </div>
          )}
        </article>
      )}

      {hasMarket && (
        <article className="bento-card bento-markets">
          <div className="bento-card-header">
            <span className="bento-kicker">Nhịp đập Thị trường</span>
            <span className="bento-location">Việt Nam · Sáng nay</span>
          </div>
          <div className="bento-market-rows">
            {gold && goldBar && (
              <div
                className="bento-market-row"
                onClick={() => onJump?.("section-gold")}
                role={onJump ? "button" : undefined}
                tabIndex={onJump ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onJump && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onJump("section-gold");
                  }
                }}
              >
                <div>
                  <strong>Vàng miếng SJC</strong>
                  <small>
                    Mua{" "}
                    {goldPricePerChi(goldBar.buy, gold.unit).toLocaleString(
                      "vi-VN",
                    )}{" "}
                    đ/chỉ
                  </small>
                </div>
                {sparklines?.sjc && sparklines.sjc.length >= 2 && (
                  <Sparkline
                    points={sparklines.sjc}
                    label="Vàng miếng SJC 30 ngày"
                    tone="amber"
                  />
                )}
                <div className="bento-market-right">
                  <strong>
                    {goldPricePerChi(goldBar.sell, gold.unit).toLocaleString(
                      "vi-VN",
                    )}{" "}
                    đ/chỉ
                  </strong>
                  {goldBar.low30?.isLowest ? (
                    <span className="low30-pill">Đáy 30 ngày</span>
                  ) : goldBar.low30?.minimum != null ? (
                    <small>
                      Đáy 30N: {goldBar.low30.minimum.toLocaleString("vi-VN")}
                    </small>
                  ) : null}
                </div>
              </div>
            )}

            {usd && (
              <div
                className="bento-market-row"
                onClick={() => onJump?.("section-usd")}
                role={onJump ? "button" : undefined}
                tabIndex={onJump ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onJump && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onJump("section-usd");
                  }
                }}
              >
                <div>
                  <strong>USD / VND (Vietcombank)</strong>
                  <small>
                    Mua CK{" "}
                    {usd.buyTransfer?.toLocaleString("vi-VN") ??
                      usd.buyCash?.toLocaleString("vi-VN") ??
                      "—"}{" "}
                    đ
                  </small>
                </div>
                {sparklines?.usd && sparklines.usd.length >= 2 && (
                  <Sparkline
                    points={sparklines.usd}
                    label="Tỷ giá USD/VND 30 ngày"
                    tone="emerald"
                  />
                )}
                <div className="bento-market-right">
                  <strong>
                    {usd.sell?.toLocaleString("vi-VN") ?? "—"} đ
                  </strong>
                  {usd.low30?.isLowest ? (
                    <span className="low30-pill">Đáy 30 ngày</span>
                  ) : usd.low30?.minimum != null ? (
                    <small>
                      Đáy 30N: {usd.low30.minimum.toLocaleString("vi-VN")}
                    </small>
                  ) : null}
                </div>
              </div>
            )}

            {fuel && (
              <div
                className="bento-market-row"
                onClick={() => onJump?.("section-fuel")}
                role={onJump ? "button" : undefined}
                tabIndex={onJump ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onJump && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onJump("section-fuel");
                  }
                }}
              >
                <div>
                  <strong>{fuel.name}</strong>
                  <small>Petrolimex vùng 1</small>
                </div>
                <div className="bento-market-right">
                  <strong>{fuel.price.toLocaleString("vi-VN")} đ/lít</strong>
                  {fuel.change !== null && fuel.change !== 0 && (
                    <span
                      className={
                        fuel.change < 0
                          ? "delta-pill delta-down"
                          : "delta-pill delta-up"
                      }
                    >
                      {fuel.change > 0 ? "▲ +" : "▼ "}
                      {fuel.change.toLocaleString("vi-VN")} đ
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
