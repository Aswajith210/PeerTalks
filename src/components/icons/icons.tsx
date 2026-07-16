import { GlassIcon } from "./GlassIcon";

type IconProps = { size?: number; className?: string; active?: boolean };

const Camera = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="1.5" y="4.5" width="15" height="15" rx="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M16.5 10.5l4-2.5v8l-4-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <circle cx="9" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
  </GlassIcon>
);

const CameraOff = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="1.5" y="4.5" width="15" height="15" rx="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M16.5 10.5l4-2.5v8l-4-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.7} />
    <circle cx="9" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
  </GlassIcon>
);

const Mic = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="8.5" y="2.5" width="7" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M5 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M12 18v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M9 21.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </GlassIcon>
);

const MicOff = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="8.5" y="2.5" width="7" height="11" rx="3.5" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M5 11a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M12 18v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.7} />
  </GlassIcon>
);

const Phone = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const PhoneEnd = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-3.23-2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M2 2l20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.5} />
    <path d="M4.11 7.07A2 2 0 002 9.93v3a2 2 0 001.72 2.05c.96.136 1.903.37 2.81.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M15.54 8.46A2 2 0 0014 7.5h-3a2 2 0 00-1.54.71" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </GlassIcon>
);

const Chat = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M8 9h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M8 13h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </GlassIcon>
);

const Users = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </GlassIcon>
);

const Reactions = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <circle cx="9" cy="9" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
    <circle cx="15" cy="9" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
  </GlassIcon>
);

const ScreenShare = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M8 21h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 8v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M9 11l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const Settings_Icon = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </GlassIcon>
);

const NoiseCancel = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M12 3a9 9 0 00-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.5} />
    <path d="M12 7a5 5 0 00-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.7} />
    <circle cx="12" cy="12" r="1" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.08)" />
    <path d="M12 3a9 9 0 019 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.5} />
    <path d="M12 7a5 5 0 015 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.7} />
    <circle cx="12" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const BackgroundBlur = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M8.5 18.5l3-4 2 2.5 2-3 2.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const Fullscreen = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M8 3H5a2 2 0 00-2 2v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M21 8V5a2 2 0 00-2-2h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M3 16v3a2 2 0 002 2h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M16 21h3a2 2 0 002-2v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const SwitchCamera = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M21 16V8a2 2 0 00-2-2h-1.5l-1.5-2h-4L11 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.3" fill="rgba(255,255,255,0.04)" />
    <path d="M17 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const Heart = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const ThumbsUp = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M14 15V9a2 2 0 00-2-2 2 2 0 002-2V3.5A1.5 1.5 0 0012.5 2 6.47 6.47 0 007 8v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M7 15h3l4 3.5a2.5 2.5 0 002 1.5h4a2 2 0 002-2v-.5a4 4 0 00-.5-2L19 11a2 2 0 00-1.75-1H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const Clap = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M7 11.5l1.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M10.5 9l1.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M14 7.5L15.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M17 6.5L18.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <path d="M6.5 13L5 14.5a4 4 0 005.66 5.66l5-5A4 4 0 0010 9.66L7 12.66" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const Fire = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M12 22c4 0 7-3 7-8 0-6-7-12-7-12s-7 6-7 12c0 5 3 8 7 8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M12 22c-2 0-3.5-1.5-3.5-4 0-2.5 3.5-6 3.5-6s3.5 3.5 3.5 6c0 2.5-1.5 4-3.5 4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const Laugh = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M8 14s1.5 3 4 3 4-3 4-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <circle cx="9" cy="9" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
    <circle cx="15" cy="9" r="1.2" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
  </GlassIcon>
);

const Celebrate = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M8 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M17 14l1 1.5 1.5 1-1.5 1-1 1.5-1-1.5-1.5-1 1.5-1 1-1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const Close = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </GlassIcon>
);

const ArrowLeft = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M19 12H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const Lock = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="5" y="11" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <circle cx="12" cy="16" r="1.5" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
    <path d="M12 16v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </GlassIcon>
);

const Sparkle = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M18 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const SearchIcon = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M20 20l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </GlassIcon>
);

const SendIcon = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
  </GlassIcon>
);

const Stop = (props: IconProps) => (
  <GlassIcon {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.06)" />
  </GlassIcon>
);

const Info = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,255,255,0.04)" />
    <path d="M12 16v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="12" cy="8" r="0.5" fill="currentColor" />
  </GlassIcon>
);

const Check = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const MoreIcon = (props: IconProps) => (
  <GlassIcon {...props}>
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
  </GlassIcon>
);

const Logo = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.06)" />
    <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </GlassIcon>
);

const Volume = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.7} />
    <path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity={0.5} />
  </GlassIcon>
);

const VolumeOff = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="rgba(255,255,255,0.04)" />
    <path d="M23 9l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.7} />
    <path d="M17 9l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={0.7} />
  </GlassIcon>
);

const Wifi = (props: IconProps) => (
  <GlassIcon {...props}>
    <path d="M5 12.55a11 11 0 0114.08 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.7} />
    <path d="M1.42 9a16 16 0 0121.16 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.4} />
    <path d="M8.53 16.11a6 6 0 016.95 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
    <circle cx="12" cy="20" r="1" stroke="currentColor" strokeWidth="1.2" fill="rgba(255,255,255,0.06)" />
  </GlassIcon>
);

const Icons = {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneEnd,
  Chat,
  Users,
  Reactions,
  ScreenShare,
  Settings: Settings_Icon,
  NoiseCancel,
  BackgroundBlur,
  Fullscreen,
  SwitchCamera,
  Heart,
  ThumbsUp,
  Clap,
  Fire,
  Laugh,
  Celebrate,
  Close,
  ArrowLeft,
  Lock,
  Sparkle,
  Search: SearchIcon,
  Send: SendIcon,
  Stop,
  Info,
  Check,
  More: MoreIcon,
  Logo,
  Volume,
  VolumeOff,
  Wifi,
} as const;

export type IconName = keyof typeof Icons;
export default Icons;
