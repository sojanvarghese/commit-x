// Lightweight color utility as chalk alternative
// Based on picocolors approach but even lighter

const ESC = "\x1b[";
const END = "m";

// Reset
const RESET = `${ESC}0${END}`;

// Colors
const colors = {
  red: (text: string) => `${ESC}31${END}${text}${RESET}`,
  green: (text: string) => `${ESC}32${END}${text}${RESET}`,
  yellow: (text: string) => `${ESC}33${END}${text}${RESET}`,
  blue: (text: string) => `${ESC}34${END}${text}${RESET}`,
  magenta: (text: string) => `${ESC}35${END}${text}${RESET}`,
  cyan: (text: string) => `${ESC}36${END}${text}${RESET}`,
  white: (text: string) => `${ESC}37${END}${text}${RESET}`,
  gray: (text: string) => `${ESC}90${END}${text}${RESET}`,
  grey: (text: string) => `${ESC}90${END}${text}${RESET}`,

  // Bright colors
  brightRed: (text: string) => `${ESC}91${END}${text}${RESET}`,
  brightGreen: (text: string) => `${ESC}92${END}${text}${RESET}`,
  brightYellow: (text: string) => `${ESC}93${END}${text}${RESET}`,
  brightBlue: (text: string) => `${ESC}94${END}${text}${RESET}`,

  // Styles
  bold: (text: string) => `${ESC}1${END}${text}${ESC}22${END}`,
  dim: (text: string) => `${ESC}2${END}${text}${ESC}22${END}`,
  italic: (text: string) => `${ESC}3${END}${text}${ESC}23${END}`,
  underline: (text: string) => `${ESC}4${END}${text}${ESC}24${END}`,

  // Background colors
  bgRed: (text: string) => `${ESC}41${END}${text}${RESET}`,
  bgGreen: (text: string) => `${ESC}42${END}${text}${RESET}`,
  bgYellow: (text: string) => `${ESC}43${END}${text}${RESET}`,
  bgBlue: (text: string) => `${ESC}44${END}${text}${RESET}`,
} as const;

// Check if colors should be disabled
const isColorDisabled = (): boolean => {
  // Disable colors if:
  // - NO_COLOR env var is set
  // - FORCE_COLOR is set to 0
  // - Not in a TTY
  // - CI environment without FORCE_COLOR
  return Boolean(
    process.env.NO_COLOR ||
      process.env.FORCE_COLOR === "0" ||
      (!process.stdout.isTTY && !process.env.FORCE_COLOR) ||
      (process.env.CI && !process.env.FORCE_COLOR)
  );
};

// Create color functions that respect NO_COLOR
const createColorFunction = (colorFn: (text: string) => string) => {
  return (text: string): string => {
    return isColorDisabled() ? text : colorFn(text);
  };
};

// Export chalk-compatible API
export const lightColors = {
  red: createColorFunction(colors.red),
  green: createColorFunction(colors.green),
  yellow: createColorFunction(colors.yellow),
  blue: createColorFunction(colors.blue),
  magenta: createColorFunction(colors.magenta),
  cyan: createColorFunction(colors.cyan),
  white: createColorFunction(colors.white),
  gray: createColorFunction(colors.gray),
  grey: createColorFunction(colors.grey),

  bold: createColorFunction(colors.bold),
  dim: createColorFunction(colors.dim),
  italic: createColorFunction(colors.italic),
  underline: createColorFunction(colors.underline),

  bgRed: createColorFunction(colors.bgRed),
  bgGreen: createColorFunction(colors.bgGreen),
  bgYellow: createColorFunction(colors.bgYellow),
  bgBlue: createColorFunction(colors.bgBlue),

  // Utility functions
  strip: (text: string): string => {
    // Remove all ANSI escape codes
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  },

  // Check if colors are supported
  supportsColor: !isColorDisabled(),
};

// Default export for drop-in replacement
export default lightColors;
