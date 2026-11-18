export type IconName =
  | "brief"
  | "calendar"
  | "activity"
  | "settings"
  | "sun"
  | "moon"
  | "arrow"
  | "send"
  | "lock"
  | "user"
  | "logout"
  | "check"
  | "search"
  | "sparkle"
  | "chevron"
  | "copy"
  | "plus"
  | "trash"
  | "bookmark"
  | "refresh"
  | "eye"
  | "eyeOff"
  | "shield"
  | "cloudRain"
  | "wind"
  | "trendingDown"
  | "external"
  | "list"
  | "grid";

export function Icon({
  name,
  size = 20,
  filled = false,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
}) {
  const paths = {
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M8 12h10" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4 4" />
      </>
    ),
    sparkle: (
      <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    brief: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" />
      </>
    ),
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    settings: (
      <>
        <polygon
          points="9.5 4.7 9.9 2.1 14.1 2.1 14.5 4.7
          17.1 6.2 19.5 5.2 21.6 8.9 19.6 10.5
          19.6 13.5 21.6 15.1 19.5 18.8 17.1 17.8
          14.5 19.3 14.1 21.9 9.9 21.9 9.5 19.3
          6.9 17.8 4.5 18.8 2.4 15.1 4.4 13.5
          4.4 10.5 2.4 8.9 4.5 5.2 6.9 6.2"
        />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    sun: (
      <>
        <path d="M3 18h18M6 21h12M2 13h3M19 13h3M12 2v3M4.9 5.9 7 8M19.1 5.9 17 8" />
        <path d="M7 15a5 5 0 0 1 10 0" />
      </>
    ),
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    send: <path d="m21 3-7 18-4-7-7-4 18-7zM10 14 21 3" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    trash: (
      <>
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </>
    ),
    bookmark: <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />,
    refresh: (
      <>
        <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
      </>
    ),
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
    cloudRain: (
      <>
        <path d="M4 14.9A5 5 0 0 1 6.5 5.3a6.5 6.5 0 0 1 12.6 1.7A4.5 4.5 0 0 1 18.5 16H6a4 4 0 0 1-2-.5" />
        <path d="M8 19v2M12 18v3M16 19v2" />
      </>
    ),
    wind: (
      <>
        <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
        <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
        <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
      </>
    ),
    trendingDown: (
      <>
        <path d="m22 17-8.5-8.5-5 5L2 7" />
        <path d="M16 17h6v-6" />
      </>
    ),
    external: (
      <>
        <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    ),
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
