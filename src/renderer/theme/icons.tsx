import type { ReactNode } from "react";

function Svg({
  children,
  size = 16,
  stroke = 2,
}: {
  children: ReactNode;
  size?: number;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const BackIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M19 12H5M11 18l-6-6 6-6" />
  </Svg>
);

export const ForwardIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M5 12h14M13 18l6-6-6-6" />
  </Svg>
);

export const ReloadIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const CloseIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const PlusIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const HomeIcon = ({ size }: P) => (
  <Svg size={size}>
    <path d="m3 11 9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </Svg>
);

export const SearchIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const LockIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <rect x="5" y="11" width="14" height="10" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const WarningIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M10.3 3.9 1.8 18.2A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);

export const InfoIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const MoonIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
  </Svg>
);

export const StarIcon = ({ size = 15, filled = false }: P & { filled?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="2"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
  </svg>
);

export const ShieldIcon = ({ size = 16, off = false }: P & { off?: boolean }) => (
  <Svg size={size}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" />
    {off ? <path d="m4 4 16 16" /> : <path d="m9 12 2 2 4-4" />}
  </Svg>
);

export const DownloadIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);

export const MenuIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </Svg>
);

export const SplitIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M12 4v16" />
  </Svg>
);

export const SpeakerIcon = ({ size = 13, muted = false }: P & { muted?: boolean }) => (
  <Svg size={size}>
    <path d="M4 9v6h4l5 4V5L8 9Z" />
    {muted ? (
      <path d="m17 9 5 5M22 9l-5 5" />
    ) : (
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    )}
  </Svg>
);

export const GlobeIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Svg>
);

export const HistoryIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </Svg>
);

export const BookmarksIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M6 3h12v18l-6-4-6 4Z" />
  </Svg>
);

export const SettingsIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </Svg>
);

export const WindowIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 9h18" />
  </Svg>
);

export const MaskIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M3 10c0-2 2-3 4.5-3S11 8 12 8s2-1 4.5-1S21 8 21 10c0 4-2 6-4.5 6-2 0-3-2-4.5-2S9.5 16 7.5 16C5 16 3 14 3 10Z" />
    <circle cx="8" cy="11" r="1.4" />
    <circle cx="16" cy="11" r="1.4" />
  </Svg>
);

export const PrintIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </Svg>
);

export const FindIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
    <circle cx="16.5" cy="15.5" r="3.5" />
    <path d="m21 20-2-2" />
  </Svg>
);

export const CodeIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
  </Svg>
);

export const ExpandIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);

export const MinusIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M5 12h14" />
  </Svg>
);

export const ChevronUpIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);

export const ChevronDownIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const FolderIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Svg>
);

export const FileIcon = ({ size = 16 }: P) => (
  <Svg size={size}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </Svg>
);

export const PauseIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
);

export const PlayIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M7 4.5v15l12-7.5Z" />
  </Svg>
);

export const TrashIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);

export const EditIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <path d="M4 20h4L19 9l-4-4L4 16Z" />
    <path d="m14 6 4 4" />
  </Svg>
);

export const TabIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <rect x="3" y="6" width="18" height="14" rx="2.5" />
    <path d="M3 10h8V6" />
  </Svg>
);

export const BoltIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <path d="M13 3 4 14h7l-1 7 9-11h-7Z" />
  </Svg>
);

export const SleepIcon = ({ size = 13 }: P) => (
  <Svg size={size}>
    <path d="M4 5h6l-6 7h6M14 12h5l-5 7h5" />
  </Svg>
);

export const ExternalIcon = ({ size = 14 }: P) => (
  <Svg size={size}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);

export const CameraIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </Svg>
);

export const MicIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const PinIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);

export const BellIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z" />
    <path d="M10 21h4" />
  </Svg>
);

export const ClipboardIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <rect x="6" y="4" width="12" height="17" rx="2" />
    <path d="M9 4V3h6v1" />
  </Svg>
);

export const PopupIcon = ({ size = 15 }: P) => (
  <Svg size={size}>
    <rect x="3" y="7" width="14" height="13" rx="2" />
    <path d="M8 7V5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" />
  </Svg>
);
