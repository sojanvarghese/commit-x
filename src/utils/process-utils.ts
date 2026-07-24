import { lightColors } from "./colors.js";
export const exitProcess = (exitCode: number = 0): void => {
  process.exitCode = exitCode;
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
  process.exitCode = 1;
};
