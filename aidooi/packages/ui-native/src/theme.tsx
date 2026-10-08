import { createContext, useContext, type ReactNode } from 'react';
import { tokens } from '@aidooi/ui-tokens';

/** AID-DATA-015 defines one light identity, so the theme is the tokens themselves — there is no dark variant to drift. */
export type Theme = typeof tokens;

const ThemeContext = createContext<Theme>(tokens);

export function ThemeProvider({
  theme = tokens,
  children,
}: {
  theme?: Theme;
  children: ReactNode;
}) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);
