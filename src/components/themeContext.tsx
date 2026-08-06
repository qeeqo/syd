import { createContext, useContext, type ReactNode } from "react";
import {
  resolveTheme,
  DEFAULT_THEME_NAME,
  type ThemeTokens,
} from "../theme.ts";

// Kept out of theme.ts so that module stays React-free for a headless core.

// Seeded with the default so a component rendered outside a provider still
// paints instead of crashing on undefined token access.
const ThemeContext = createContext<ThemeTokens>(
  resolveTheme(DEFAULT_THEME_NAME).tokens,
);

export function ThemeProvider({
  tokens,
  children,
}: {
  tokens: ThemeTokens;
  children: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={tokens}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
