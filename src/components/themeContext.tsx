import { createContext, useContext, type ReactNode } from "react";
import {
  resolveTheme,
  DEFAULT_THEME_NAME,
  type ThemeTokens,
} from "../theme.ts";

// React glue for the pure theme module. Components read the active palette via
// useTheme() and get back the token set (t.accent, t.danger, …), so a live theme
// switch in App re-renders the whole tree with new colors — no restart.
//
// Kept out of theme.ts on purpose: that module stays React-free so a headless
// core can import the palettes without pulling in React.

// Seed the context with the resolved default so a component rendered outside a
// provider (shouldn't happen, but be defensive) still paints instead of crashing
// on undefined token access.
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

// The single accessor every component uses. Returns the active theme's tokens.
export function useTheme(): ThemeTokens {
  return useContext(ThemeContext);
}
