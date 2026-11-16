export function Icon({
  name,
  size = 20,
}: {
  name:
    | "brief"
    | "calendar"
    | "activity"
    | "settings"
    | "sun"
    | "arrow"
    | "send"
    | "lock"
    | "user"
    | "logout"
    | "check"
    | "search"
    | "sparkle"
    | "chevron";
  size?: number;
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
    activity: (
      <>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
      </>
    ),
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
    arrow: (
      <>
        <path d="M5 12h14m-5-5 5 5-5 5" />
      </>
    ),
    send: (
      <>
        <path d="m21 3-7 18-4-7-7-4 18-7zM10 14 21 3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
