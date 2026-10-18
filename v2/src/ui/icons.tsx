// Inline stroke icons from the design (24×24 grid), coloured by currentColor.
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
}

function stroke(children: ReactNode, { size = 24 }: IconProps, width = 1.8) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function fill(children: ReactNode, { size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => stroke(<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />, props);
export const CassetteIcon = (props: IconProps) =>
  stroke(<><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><circle cx="16" cy="11" r="2" /><path d="M7 19l1.5-3h7L17 19" /></>, props);
export const BookmarkIcon = (props: IconProps) => stroke(<path d="M6 4h12v16l-6-4-6 4z" />, props);
export const BookmarkFilledIcon = (props: IconProps) => fill(<path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.5.5 0 0 1-.79.41L12 16.6l-5.71 4a.5.5 0 0 1-.79-.4V4a.5.5 0 0 1 .5-.5z" />, props);
export const UserIcon = (props: IconProps) => stroke(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, props);
export const BackIcon = (props: IconProps) => stroke(<path d="M15 18l-6-6 6-6" />, props, 2);
export const ChevronIcon = (props: IconProps) => stroke(<path d="M9 6l6 6-6 6" />, props, 2);
export const CloseIcon = (props: IconProps) => stroke(<path d="M6 6l12 12M18 6 6 18" />, props, 2);
export const SearchIcon = (props: IconProps) => stroke(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, props);
export const ReplayIcon = (props: IconProps) => stroke(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>, props);
export const SparkleIcon = (props: IconProps) => stroke(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />, props);
export const MicIcon = (props: IconProps) => stroke(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>, props);
export const SpeakerIcon = (props: IconProps) => stroke(<><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16 9a4 4 0 0 1 0 6" /></>, props);
export const FileIcon = (props: IconProps) => stroke(<><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></>, props);
export const CheckIcon = (props: IconProps) => stroke(<path d="M5 12l5 5 9-10" />, props, 2.4);
export const ReelIcon = (props: IconProps) => stroke(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></>, props, 2);
export const PlayIcon = (props: IconProps) => fill(<path d="M8 5v14l11-7z" />, props);
export const StopIcon = (props: IconProps) => fill(<rect x="6" y="6" width="12" height="12" rx="2" />, props);
export const DownloadIcon = (props: IconProps) => stroke(<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>, props);
export const PauseIcon = (props: IconProps) => fill(<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />, props);
export const PrevIcon = (props: IconProps) => fill(<><path d="M19 20 9 12l10-8z" /><rect x="4" y="5" width="2" height="14" rx="1" /></>, props);
export const NextIcon = (props: IconProps) => fill(<><path d="M5 4l10 8-10 8z" /><rect x="18" y="5" width="2" height="14" rx="1" /></>, props);
export const MoreIcon = (props: IconProps) => fill(<><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></>, props);
