import { watchConditionsSchema, type WatchInput } from "@hub/contracts";
import type { IconName } from "../Icons";
import type { Source } from "./types";

export type WatchTemplate = {
  id: string;
  tag: string;
  icon: IconName;
  name: string;
  summary: string;
  description: string;
  anyKeywords: string[];
  excludeKeywords: string[];
  preferredSourceTerms: string[];
};

export const WATCH_TEMPLATES: readonly WatchTemplate[] = [
  {
    id: "it-intern-fresher",
    tag: "Sự nghiệp & Sinh viên",
    icon: "brief",
    name: "Thực tập & Tuyển dụng IT / Công nghệ",
    summary: "Lọc tin tuyển thực tập sinh, fresher, ngày hội việc làm công nghệ và nhân lực số.",
    description:
      "Theo dõi chương trình thực tập sinh, fresher công nghệ thông tin, tuyển dụng kỹ sư phần mềm, học bổng doanh nghiệp công nghệ tại Việt Nam.",
    anyKeywords: [
      "thực tập sinh",
      "fresher",
      "tuyển dụng IT",
      "kỹ sư phần mềm",
      "nhân lực công nghệ",
      "ngày hội việc làm",
    ],
    excludeKeywords: ["quảng cáo"],
    preferredSourceTerms: ["công nghệ", "giáo dục", "số hóa", "vnexpress", "tuổi trẻ"],
  },
  {
    id: "scholarship-study-abroad",
    tag: "Giáo dục",
    icon: "sparkle",
    name: "Học bổng & Du học Quốc tế",
    summary: "Săn học bổng chính phủ, trao đổi sinh viên và hỗ trợ tài chính đại học/sau đại học.",
    description:
      "Các chương trình học bổng toàn phần, học bổng chính phủ, trao đổi sinh viên quốc tế và tuyển sinh sau đại học.",
    anyKeywords: [
      "học bổng",
      "du học",
      "học bổng chính phủ",
      "trao đổi sinh viên",
      "hỗ trợ tài chính",
    ],
    excludeKeywords: [],
    preferredSourceTerms: ["giáo dục", "thế giới", "vnexpress", "tuổi trẻ"],
  },
  {
    id: "macro-rates-gold",
    tag: "Tài chính cá nhân",
    icon: "activity",
    name: "Lãi suất, Vàng SJC & Tỷ giá",
    summary: "Bắt nhanh điều chỉnh lãi suất tiết kiệm/cho vay, chính sách tiền tệ và biến động vàng.",
    description:
      "Biến động lãi suất tiết kiệm, lãi suất vay ngân hàng, điều hành tỷ giá USD/VND và thị trường vàng miếng SJC.",
    anyKeywords: [
      "lãi suất",
      "giá vàng SJC",
      "tỷ giá USD",
      "Ngân hàng Nhà nước",
      "lãi suất tiết kiệm",
    ],
    excludeKeywords: [],
    preferredSourceTerms: ["kinh doanh", "tài chính", "kinh tế", "vnexpress"],
  },
  {
    id: "real-estate-housing",
    tag: "An cư & Đầu tư",
    icon: "grid",
    name: "Nhà ở xã hội & Quy hoạch Đô thị",
    summary: "Theo dõi dự án nhà ở xã hội, gói vay mua nhà ưu đãi, quy hoạch hạ tầng & metro.",
    description:
      "Thông tin mở bán nhà ở xã hội, gói tín dụng vay mua nhà, quy hoạch hạ tầng giao thông và pháp lý bất động sản.",
    anyKeywords: [
      "nhà ở xã hội",
      "vay mua nhà",
      "quy hoạch",
      "chung cư",
      "luật đất đai",
    ],
    excludeKeywords: [],
    preferredSourceTerms: ["kinh doanh", "bất động sản", "thời sự", "vnexpress"],
  },
  {
    id: "ai-semiconductor-startup",
    tag: "Công nghệ mới",
    icon: "sparkle",
    name: "AI, Bán dẫn & Khởi nghiệp",
    summary: "Cập nhật mô hình AI mới, chuỗi cung ứng chip bán dẫn và thương vụ gọi vốn startup Việt.",
    description:
      "Ứng dụng trí tuệ nhân tạo tạo sinh, công nghiệp bán dẫn, trung tâm dữ liệu và gọi vốn khởi nghiệp công nghệ.",
    anyKeywords: [
      "trí tuệ nhân tạo",
      "bán dẫn",
      "chip AI",
      "khởi nghiệp",
      "gọi vốn",
      "chuyển đổi số",
    ],
    excludeKeywords: [],
    preferredSourceTerms: ["công nghệ", "số hóa", "kinh doanh", "vnexpress"],
  },
  {
    id: "university-admissions",
    tag: "Mùa thi & Gia đình",
    icon: "calendar",
    name: "Tuyển sinh Đại học & Thi cử",
    summary: "Điểm chuẩn, phương thức xét tuyển mới, lịch thi đánh giá năng lực & tốt nghiệp THPT.",
    description:
      "Phương án tuyển sinh đại học, lịch thi tốt nghiệp THPT, kỳ thi đánh giá năng lực và điểm chuẩn các trường.",
    anyKeywords: [
      "tuyển sinh đại học",
      "điểm chuẩn",
      "đánh giá năng lực",
      "thi tốt nghiệp THPT",
      "xét tuyển",
    ],
    excludeKeywords: [],
    preferredSourceTerms: ["giáo dục", "thời sự", "vnexpress", "tuổi trẻ"],
  },
];

export function buildWatchDraftFromTemplate(
  template: WatchTemplate,
  availableSources: Source[],
  minIntervalMinutes: number,
): WatchInput {
  const scored = availableSources.map((src) => {
    const hay = `${src.name} ${src.url}`.toLowerCase();
    const hits = template.preferredSourceTerms.reduce(
      (acc, term) => (hay.includes(term.toLowerCase()) ? acc + 1 : acc),
      0,
    );
    return { src, hits, rank: src.catalog_rank ?? 999 };
  });
  scored.sort((a, b) => b.hits - a.hits || a.rank - b.rank);
  const pickedIds = scored.slice(0, Math.min(4, scored.length)).map((x) => x.src.id);

  return {
    name: template.name,
    description: template.description,
    conditions: watchConditionsSchema.parse({
      anyKeywords: template.anyKeywords,
      allKeywords: [],
      excludeKeywords: template.excludeKeywords,
    }),
    sourceIds: pickedIds,
    intervalMinutes: Math.max(minIntervalMinutes, 360),
    lookbackDays: 2,
    enabled: true,
    confirmed: true,
  };
}
