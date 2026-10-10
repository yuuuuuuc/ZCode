import type { Theme } from "@zcode/ui";

export const WEB_DEFAULT_THEME: Theme = "zai-dark";

const THEME_VALUES = new Set<Theme>([
  "system",
  "light",
  "dark",
  "zai-light",
  "zai-dark",
]);

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEME_VALUES.has(value as Theme);
}

export function resolveWebInitialTheme({
  storedTheme,
  defaultTheme = WEB_DEFAULT_THEME,
}: {
  storedTheme?: string | null;
  defaultTheme?: Theme;
}): Theme {
  if (isTheme(storedTheme)) {
    return storedTheme;
  }
  return defaultTheme;
}
