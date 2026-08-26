import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type GreenroomTheme = "light" | "dark";

const themeStorageKey = "greenroom.theme";
const themeColorByTheme: Record<GreenroomTheme, string> = {
  light: "#f7f8f5",
  dark: "#101412",
};

interface ThemeContextValue {
  theme: GreenroomTheme;
  setTheme: (theme: GreenroomTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<GreenroomTheme>(() => readStoredGreenroomTheme());

  useEffect(() => {
    applyGreenroomTheme(theme);
    storeGreenroomTheme(theme);
  }, [theme]);

  const setTheme = useCallback((nextTheme: GreenroomTheme) => {
    setThemeState(nextTheme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useGreenroomTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (value === null) {
    throw new Error("useGreenroomTheme must be used within ThemeProvider");
  }

  return value;
}

export function readStoredGreenroomTheme(): GreenroomTheme {
  if (typeof window === "undefined") {
    return "light";
  }

  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    return isGreenroomTheme(storedTheme) ? storedTheme : "light";
  } catch {
    return "light";
  }
}

export function applyGreenroomTheme(theme: GreenroomTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColorByTheme[theme]);
}

function storeGreenroomTheme(theme: GreenroomTheme): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    return;
  }
}

function isGreenroomTheme(value: string | null): value is GreenroomTheme {
  return value === "light" || value === "dark";
}
