import type { BookmarkKind } from "@hub/contracts";
import { Icon } from "../../Icons";

export function BookmarkButton({
  saved,
  busy = false,
  onToggle,
  title,
}: {
  saved: boolean;
  busy?: boolean;
  onToggle: () => void;
  title: string;
  kind?: BookmarkKind;
}) {
  return (
    <button
      type="button"
      className={saved ? "bookmark-inline-btn saved" : "bookmark-inline-btn"}
      disabled={busy}
      aria-pressed={saved}
      aria-label={(saved ? "Bỏ lưu: " : "Lưu đọc sau: ") + title}
      title={saved ? "Đã lưu vào danh sách đọc sau" : "Lưu đọc sau"}
      onClick={onToggle}
    >
      <Icon name="bookmark" size={15} filled={saved} />
      <span>{saved ? "Đã lưu" : "Lưu"}</span>
    </button>
  );
}
