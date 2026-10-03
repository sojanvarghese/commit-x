import { styleText } from "node:util";

type Format = Parameters<typeof styleText>[0];

// styleText already honours NO_COLOR, FORCE_COLOR and whether stdout is a TTY.
const style =
  (format: Format) =>
  (text: string): string =>
    styleText(format, text);

export const lightColors = {
  red: style("red"),
  green: style("green"),
  yellow: style("yellow"),
  blue: style("blue"),
  magenta: style("magenta"),
  cyan: style("cyan"),
  white: style("white"),
  gray: style("gray"),
};
