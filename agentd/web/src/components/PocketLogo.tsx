import { useId } from "react";

/** 品牌 Logo：渐变口袋 + 智能点。同一页面多处渲染时 id 不冲突。 */
export function PocketLogo({ size = 34 }: { size?: number }) {
  const uid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="232" fill={`url(#${uid})`} />
      <path d="M300 390a212 212 0 0 0 424 0" fill="none" stroke="#ffffff" strokeWidth="80" strokeLinecap="round" />
      <path d="M300 390h128M596 390h128" stroke="#ffffff" strokeWidth="80" strokeLinecap="round" />
      <circle cx="512" cy="472" r="58" fill="var(--logo-dot, #0f1115)" opacity="0.9" />
    </svg>
  );
}
