// 主题管理：dark / light / system，localStorage 持久化

export type ThemePref = "dark" | "light" | "system";
const KEY = "pa-theme";

const DARK_META = "#0f1115";
const LIGHT_META = "#f4f6f8";

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "system";
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref);
  applyTheme();
}

export function applyTheme(): boolean {
  const pref = getThemePref();
  const systemDark = !window.matchMedia("(prefers-color-scheme: light)").matches;
  const isDark = pref === "dark" || (pref === "system" && systemDark);
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? DARK_META : LIGHT_META);
  return isDark;
}
