import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import { lightColors } from "./colors.js";

type PromptValidation = string | boolean | Promise<string | boolean>;

export interface BasePromptOptions<T> {
  message: string;
  default?: T;
  validate?: (input: T) => PromptValidation;
}

export interface ConfirmOptions extends BasePromptOptions<boolean> {
  type: "confirm";
}

export interface InputOptions extends BasePromptOptions<string> {
  type: "input";
}

export interface PromptChoice<T> {
  name: string;
  value: T;
  short?: string;
}

export interface ListOptions<T = unknown> extends BasePromptOptions<T> {
  type: "list";
  choices: Array<PromptChoice<T>>;
  pageSize?: number;
}

export type PromptOptions =
  ConfirmOptions | InputOptions | ListOptions<unknown>;
export type PromptQuestion = Record<string, PromptOptions>;

type PromptAnswer<T> = T extends ConfirmOptions
  ? boolean
  : T extends InputOptions
    ? string
    : T extends ListOptions<infer Value>
      ? Value
      : never;

export type PromptAnswers<T extends PromptQuestion> = {
  [Key in keyof T]: PromptAnswer<T[Key]>;
};

export class LightPrompts {
  private rl: ReadlineInterface | null = null;

  private createReadline(): ReadlineInterface {
    this.rl ??= createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    return this.rl;
  }

  private closeReadline(): void {
    this.rl?.close();
    this.rl = null;
  }

  async prompt<const Questions extends PromptQuestion>(
    questions: Questions
  ): Promise<PromptAnswers<Questions>> {
    const results: Record<string, unknown> = {};
    const rl = this.createReadline();

    try {
      for (const [name, options] of Object.entries(questions)) {
        switch (options.type) {
          case "confirm":
            results[name] = await this.confirmPrompt(rl, options);
            break;
          case "input":
            results[name] = await this.inputPrompt(rl, options);
            break;
          case "list":
            results[name] = await this.listPrompt(rl, options);
            break;
        }
      }

      return results as PromptAnswers<Questions>;
    } finally {
      this.closeReadline();
    }
  }

  private async confirmPrompt(
    rl: ReadlineInterface,
    options: ConfirmOptions
  ): Promise<boolean> {
    const defaultValue = options.default ?? false;
    const suffix = defaultValue ? " (Y/n)" : " (y/N)";
    const message = `${lightColors.cyan("?")} ${options.message}${suffix} `;

    return new Promise((resolve, reject) => {
      const askQuestion = (): void => {
        rl.question(message, async (answer: string) => {
          const trimmed = answer.trim().toLowerCase();

          let result: boolean;
          if (trimmed === "") {
            result = defaultValue;
          } else if (trimmed === "y" || trimmed === "yes") {
            result = true;
          } else if (trimmed === "n" || trimmed === "no") {
            result = false;
          } else {
            console.log(lightColors.red("Please answer with y/yes or n/no."));
            askQuestion();
            return;
          }

          if (options.validate) {
            try {
              const validation = await options.validate(result);
              if (validation !== true) {
                console.log(
                  lightColors.red(
                    typeof validation === "string"
                      ? validation
                      : "Invalid input"
                  )
                );
                askQuestion();
                return;
              }
            } catch (error) {
              reject(error);
              return;
            }
          }

          resolve(result);
        });
      };

      askQuestion();
    });
  }

  private async inputPrompt(
    rl: ReadlineInterface,
    options: InputOptions
  ): Promise<string> {
    const defaultSuffix = options.default ? ` (${options.default})` : "";
    const message = `${lightColors.cyan("?")} ${options.message}${defaultSuffix} `;

    return new Promise((resolve, reject) => {
      const askQuestion = (): void => {
        rl.question(message, async (answer: string) => {
          const trimmed = answer.trim();
          const result = trimmed === "" ? (options.default ?? "") : trimmed;

          if (options.validate) {
            try {
              const validation = await options.validate(result);
              if (validation !== true) {
                console.log(
                  lightColors.red(
                    typeof validation === "string"
                      ? validation
                      : "Invalid input"
                  )
                );
                askQuestion();
                return;
              }
            } catch (error) {
              reject(error);
              return;
            }
          }

          resolve(result);
        });
      };

      askQuestion();
    });
  }

  private async listPrompt(
    rl: ReadlineInterface,
    options: ListOptions<unknown>
  ): Promise<unknown> {
    const { choices } = options;

    console.log(`${lightColors.cyan("?")} ${options.message}`);
    choices.forEach((choice, index) => {
      console.log(`  ${lightColors.dim(`${index + 1})`)} ${choice.name}`);
    });

    const message = `${lightColors.cyan("  Answer:")} `;

    return new Promise((resolve, reject) => {
      const askQuestion = (): void => {
        rl.question(message, async (answer: string) => {
          const trimmed = answer.trim();
          let selectedIndex: number;

          const choiceNumber = Number.parseInt(trimmed, 10);
          if (
            !Number.isNaN(choiceNumber) &&
            choiceNumber >= 1 &&
            choiceNumber <= choices.length
          ) {
            selectedIndex = choiceNumber - 1;
          } else {
            const foundIndex = choices.findIndex(
              choice =>
                choice.name.toLowerCase() === trimmed.toLowerCase() ||
                choice.short?.toLowerCase() === trimmed.toLowerCase()
            );

            if (foundIndex === -1) {
              console.log(
                lightColors.red(
                  `Please choose a number between 1-${choices.length} or enter the choice name.`
                )
              );
              askQuestion();
              return;
            }
            selectedIndex = foundIndex;
          }

          const selected = choices[selectedIndex];
          if (!selected) {
            reject(new Error("Selected prompt choice is unavailable"));
            return;
          }

          if (options.validate) {
            try {
              const validation = await options.validate(selected.value);
              if (validation !== true) {
                console.log(
                  lightColors.red(
                    typeof validation === "string"
                      ? validation
                      : "Invalid selection"
                  )
                );
                askQuestion();
                return;
              }
            } catch (error) {
              reject(error);
              return;
            }
          }

          resolve(selected.value);
        });
      };

      askQuestion();
    });
  }
}

const lightPrompts = new LightPrompts();

export const prompt = <const Questions extends PromptQuestion>(
  questions: Questions
): Promise<PromptAnswers<Questions>> => lightPrompts.prompt(questions);

export default { prompt };
