import { lightColors } from "./colors.js";
import { UI_CONSTANTS } from "../constants/ui.js";

export const exitProcess = (exitCode: number = 0): void => {
  setTimeout(() => process.exit(exitCode), UI_CONSTANTS.EXIT_DELAY_MS);
};

export const handleError = (error: unknown, context?: string): void => {
  const errorMessage = context ? `${context}: ${error}` : `Error: ${error}`;
  console.error(lightColors.red(errorMessage));
  exitProcess(1);
};

export const handleErrorImmediate = (
  error: unknown,
  context?: string
): void => {
  const errorMessage = context ? `${context}: ${error}` : `Error: ${error}`;
  console.error(lightColors.red(errorMessage));
  process.exit(1);
};
