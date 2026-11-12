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
    | "send";
  size?: number;
}) {
  const paths = {
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
        <path d="m9 4 1-2h4l1 2 3 2 2 1v4l-2 1-1 3v3l-3 2-2-1-3-1-2 1-3-2v-3l-1-3-2-1V7l2-1 3-2z" />
        <circle cx="12" cy="10" r="3" />
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
