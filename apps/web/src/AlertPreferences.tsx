import { defaultAlerts, type FamilyProfile } from "@hub/contracts";

export default function AlertPreferences({
  value,
  onChange,
}: {
  value: FamilyProfile["alerts"];
  onChange: (v: NonNullable<FamilyProfile["alerts"]>) => void;
}) {
  const rules = value ?? defaultAlerts;
  return (
    <section className="family-alerts">
      <h3>Cảnh báo biến động</h3>
      <label className="family-check">
        <input
          type="checkbox"
          checked={rules.enabled}
          onChange={(e) => onChange({ ...rules, enabled: e.target.checked })}
        />
        Nhận cảnh báo ngoài bản tin định kỳ
      </label>
      {rules.enabled && (
        <>
          <div className="family-fields">
            <label>
              Vàng thay đổi ít nhất (đồng/chỉ)
              <input
                type="number"
                min="1000"
                max="10000000"
                step="1000"
                value={Number.isNaN(rules.goldChange) ? "" : rules.goldChange}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    goldChange:
                      e.target.value === ""
                        ? Number.NaN
                        : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              USD thay đổi ít nhất (đồng/USD)
              <input
                type="number"
                min="1"
                max="10000"
                value={Number.isNaN(rules.usdChange) ? "" : rules.usdChange}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    usdChange:
                      e.target.value === ""
                        ? Number.NaN
                        : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              AQI Mỹ vượt ngưỡng
              <input
                type="number"
                min="50"
                max="500"
                value={
                  Number.isNaN(rules.aqiThreshold) ? "" : rules.aqiThreshold
                }
                onChange={(e) =>
                  onChange({
                    ...rules,
                    aqiThreshold:
                      e.target.value === ""
                        ? Number.NaN
                        : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <p className="muted">
            Áp dụng cho nguồn đã chọn. Kiểm tra mỗi 30 phút vào ngày nhận, sau
            giờ bản tin và trong 09:00–20:00. Tối đa 2 cảnh báo/ngày, cách nhau
            ít nhất 6 giờ. So với giá lần thông báo gần nhất; lần đầu chỉ ghi
            nhận mốc. AQI là dự báo, cảnh báo khi đi từ dưới lên ngưỡng.
          </p>
        </>
      )}
    </section>
  );
}
