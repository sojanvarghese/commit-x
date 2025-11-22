// Lightweight prompts utility as inquirer alternative
// Focused on the essential functionality needed by commit-x

import { createInterface } from 'readline';
import { lightColors } from './colors.js';

export interface BasePromptOptions {
  message: string;
  default?: any;
  validate?: (input: any) => string | boolean | Promise<string | boolean>;
}

export interface ConfirmOptions extends BasePromptOptions {
  type: 'confirm';
  default?: boolean;
}

export interface InputOptions extends BasePromptOptions {
  type: 'input';
  default?: string;
}

export interface ListOptions extends BasePromptOptions {
  type: 'list';
  choices: Array<{ name: string; value: any; short?: string }>;
  pageSize?: number;
}

export type PromptOptions = ConfirmOptions | InputOptions | ListOptions;

export interface PromptQuestion {
  [key: string]: PromptOptions;
}

export class LightPrompts {
  private rl: any;

  private createReadline() {
    if (!this.rl) {
      this.rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
      });
    }
    return this.rl;
  }

  private closeReadline() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async prompt<T = any>(questions: PromptQuestion): Promise<T> {
    const results: any = {};
    const rl = this.createReadline();

    try {
      for (const [name, options] of Object.entries(questions)) {
        let result: any;

        switch (options.type) {
          case 'confirm':
            result = await this.confirmPrompt(rl, options);
            break;
          case 'input':
            result = await this.inputPrompt(rl, options);
            break;
          case 'list':
            result = await this.listPrompt(rl, options);
            break;
          default:
            throw new Error(`Unsupported prompt type: ${(options as any).type}`);
        }

        results[name] = result;
      }

      return results as T;
    } finally {
      this.closeReadline();
    }
  }

  private async confirmPrompt(rl: any, options: ConfirmOptions): Promise<boolean> {
    const defaultValue = options.default ?? false;
    const suffix = defaultValue ? ' (Y/n)' : ' (y/N)';
    const message = `${lightColors.cyan('?')  } ${  options.message  }${suffix  } `;

    return new Promise((resolve, reject) => {
      const askQuestion = () => {
        rl.question(message, async (answer: string) => {
          const trimmed = answer.trim().toLowerCase();

          let result: boolean;
          if (trimmed === '') {
            result = defaultValue;
          } else if (trimmed === 'y' || trimmed === 'yes') {
            result = true;
          } else if (trimmed === 'n' || trimmed === 'no') {
            result = false;
          } else {
            console.log(lightColors.red('Please answer with y/yes or n/no.'));
            askQuestion();
            return;
          }

          if (options.validate) {
            try {
              const validation = await options.validate(result);
              if (validation !== true) {
                console.log(lightColors.red(typeof validation === 'string' ? validation : 'Invalid input'));
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

  private async inputPrompt(rl: any, options: InputOptions): Promise<string> {
    const defaultSuffix = options.default ? ` (${options.default})` : '';
    const message = `${lightColors.cyan('?')  } ${  options.message  }${defaultSuffix  } `;

    return new Promise((resolve, reject) => {
      const askQuestion = () => {
        rl.question(message, async (answer: string) => {
          const result = answer.trim() || options.default || '';

          if (options.validate) {
            try {
              const validation = await options.validate(result);
              if (validation !== true) {
                console.log(lightColors.red(typeof validation === 'string' ? validation : 'Invalid input'));
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

  private async listPrompt(rl: any, options: ListOptions): Promise<any> {
    const choices = options.choices;

    // Display choices
    console.log(`${lightColors.cyan('?')  } ${  options.message}`);
    choices.forEach((choice, index) => {
      console.log(`  ${lightColors.dim(`${index + 1})`)} ${choice.name}`);
    });

    const message = `${lightColors.cyan('  Answer:')  } `;

    return new Promise((resolve, reject) => {
      const askQuestion = () => {
        rl.question(message, async (answer: string) => {
          const trimmed = answer.trim();
          let selectedIndex: number;

          // Try to parse as number
          const num = parseInt(trimmed, 10);
          if (!isNaN(num) && num >= 1 && num <= choices.length) {
            selectedIndex = num - 1;
          } else {
            // Try to find by name
            const foundIndex = choices.findIndex(choice =>
              choice.name.toLowerCase() === trimmed.toLowerCase() ||
              choice.short?.toLowerCase() === trimmed.toLowerCase()
            );

            if (foundIndex !== -1) {
              selectedIndex = foundIndex;
            } else {
              console.log(lightColors.red(`Please choose a number between 1-${choices.length} or enter the choice name.`));
              askQuestion();
              return;
            }
          }

          const selected = choices[selectedIndex];

          if (options.validate) {
            try {
              const validation = await options.validate(selected.value);
              if (validation !== true) {
                console.log(lightColors.red(typeof validation === 'string' ? validation : 'Invalid selection'));
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

export const prompt = lightPrompts.prompt.bind(lightPrompts);
export default { prompt };
