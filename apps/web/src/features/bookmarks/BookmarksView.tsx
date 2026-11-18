import { useMemo, useState } from "react";
import { foldVi, formatDateTime, type BookmarkItem } from "@hub/contracts";
import { Icon } from "../../Icons";
import { ExternalLink } from "../../components/ExternalLink";

const KIND_LABELS: Record<BookmarkItem["kind"], string> = {
  rss: "Tin tức",
  custom: "Theo dõi riêng",
  github: "GitHub",
};

export function BookmarksView({
  items,
  timezone,
  onRemove,
}: {
  items: BookmarkItem[];
  timezone?: string;
  onRemove: (id: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | BookmarkItem["kind"]>("all");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const needle = foldVi(query.trim());
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (kindFilter !== "all" && item.kind !== kindFilter) return false;
        if (!needle) return true;
        return foldVi(`${item.title} ${item.source} ${item.summary}`).includes(
          needle,
        );
      }),
    [items, kindFilter, needle],
  );

  return (
    <section className="bookmarks-view">
      <div className="page-heading">
        <div>
          <h1>Danh sách đọc sau</h1>
          <p className="muted">
            Lưu lại những bài báo, cơ hội và dự án GitHub đáng chú ý để đọc kỹ khi rảnh.
          </p>
        </div>
        <span className="reading-stats-pill">{items.length}/200 mục đã lưu</span>
      </div>

      {items.length > 0 && (
        <div className="digest-reader-toolbar">
          <div className="digest-reader-search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Tìm trong mục đã lưu (hỗ trợ gõ không dấu)…"
              aria-label="Tìm bài viết đã lưu"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="source-filter-pills" role="group" aria-label="Lọc theo loại">
            {(
              [
                ["all", `Tất cả (${items.length})`],
                ["rss", "Tin tức"],
                ["custom", "Theo dõi riêng"],
                ["github", "GitHub"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={kindFilter === key}
                className={kindFilter === key ? "pill-active" : undefined}
                onClick={() => setKindFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <span className="account-empty-icon">
            <Icon name="bookmark" size={30} />
          </span>
          <strong>Chưa có bài viết nào trong danh sách đọc sau</strong>
          <p>
            Khi đọc bản tin buổi sáng, bấm biểu tượng <strong>Lưu</strong> cạnh bất kỳ
            bài báo hoặc dự án GitHub nào để giữ lại tại đây.
          </p>
          <a className="account-empty-action" href="#/digests">
            Mở bản tin của tôi <Icon name="arrow" size={17} />
          </a>
        </div>
      ) : filtered.length === 0 ? (
        <div className="account-card">
          <p className="muted">Không có mục đã lưu nào khớp bộ lọc hiện tại.</p>
        </div>
      ) : (
        <ul className="bookmark-cards">
          {filtered.map((item) => (
            <li key={item.id} className="bookmark-card">
              <div className="bookmark-card-body">
                <div className="bookmark-card-meta">
                  <span className={"bookmark-kind-badge kind-" + item.kind}>
                    {KIND_LABELS[item.kind]}
                  </span>
                  <strong>{item.source}</strong>
                  <span>· Lưu lúc {formatDateTime(item.createdAt, timezone)}</span>
                </div>
                <h3>
                  <ExternalLink href={item.url}>{item.title}</ExternalLink>
                </h3>
                {item.summary && <p>{item.summary}</p>}
                {item.digestId && (
                  <a
                    href={"#/digests/" + item.digestId}
                    className="text-link bookmark-digest-link"
                  >
                    Từ bản tin gốc <Icon name="arrow" size={14} />
                  </a>
                )}
              </div>
              <button
                type="button"
                className="bookmark-remove-btn"
                disabled={removingId === item.id}
                aria-label={"Bỏ lưu " + item.title}
                onClick={async () => {
                  setRemovingId(item.id);
                  try {
                    await onRemove(item.id);
                  } finally {
                    setRemovingId(null);
                  }
                }}
              >
                <Icon name="trash" size={16} />
                <span>{removingId === item.id ? "Đang xóa…" : "Bỏ lưu"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
