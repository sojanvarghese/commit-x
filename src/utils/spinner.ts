import { lightColors } from './colors.js';

export interface SpinnerOptions {
  text?: string;
  color?: 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'gray';
  interval?: number;
  stream?: typeof process.stderr;
  frames?: string[];
}

export class LightSpinner {
  private text: string;
  private readonly color: string;
  private readonly interval: number;
  private readonly stream: typeof process.stderr;
  private frames: string[];
  private isSpinning = false;
  private currentFrame = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private lastLength = 0;

  private static readonly DEFAULT_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private static readonly FALLBACK_FRAMES = ['|', '/', '-', '\\'];

  constructor(options: SpinnerOptions | string = {}) {
    if (typeof options === 'string') {
      options = { text: options };
    }

    this.text = options.text ?? '';
    this.color = options.color ?? 'cyan';
    this.interval = options.interval ?? 80;
    this.stream = options.stream ?? process.stderr;

    const useUnicode = process.stdout.isTTY && !process.env.CI;
    this.frames = options.frames ?? (useUnicode ? LightSpinner.DEFAULT_FRAMES : LightSpinner.FALLBACK_FRAMES);
  }

  start(text?: string): this {
    if (text) {
      this.text = text;
    }

    if (this.isSpinning) {
      return this;
    }

    if (!this.stream.isTTY) {
      if (this.text) {
        this.stream.write(`${this.text  }\n`);
      }
      return this;
    }

    this.isSpinning = true;
    this.currentFrame = 0;

    this.stream.write('\u001B[?25l');

    this.render();
    this.timer = setInterval(() => {
      this.render();
    }, this.interval);

    return this;
  }

  stop(): this {
    if (!this.isSpinning) {
      return this;
    }

    this.isSpinning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.stream.isTTY) {
      this.clear();
      this.stream.write('\u001B[?25h');
    }

    return this;
  }

  succeed(text?: string): this {
    this.stop();
    const message = text ?? this.text;
    if (message) {
      this.stream.write(`${lightColors.green('✓')} ${message}\n`);
    }
    return this;
  }

  fail(text?: string): this {
    this.stop();
    const message = text ?? this.text;
    if (message) {
      this.stream.write(`${lightColors.red('✗')} ${message}\n`);
    }
    return this;
  }

  warn(text?: string): this {
    this.stop();
    const message = text ?? this.text;
    if (message) {
      this.stream.write(`${lightColors.yellow('⚠')} ${message}\n`);
    }
    return this;
  }

  info(text?: string): this {
    this.stop();
    const message = text ?? this.text;
    if (message) {
      this.stream.write(`${lightColors.blue('ℹ')} ${message}\n`);
    }
    return this;
  }

  get isRunning(): boolean {
    return this.isSpinning;
  }

  set spinner(frames: string[]) {
    this.frames = frames;
  }

  set message(text: string) {
    this.text = text;
  }

  get message(): string {
    return this.text;
  }

  private render(): void {
    if (!this.stream.isTTY) {
      return;
    }

    const frame = this.frames[this.currentFrame];
    const colorKey = this.color as keyof typeof lightColors;
    const colorFn = (typeof lightColors[colorKey] === 'function' ? lightColors[colorKey] : lightColors.cyan) as (text: string) => string;
    const line = `${colorFn(frame)} ${this.text}`;

    this.clear();
    this.stream.write(line);
    this.lastLength = this.stripAnsi(line).length;

    this.currentFrame = (this.currentFrame + 1) % this.frames.length;
  }

  private clear(): void {
    if (this.lastLength > 0) {
      this.stream.write(`\r${  ' '.repeat(this.lastLength)  }\r`);
    }
  }

  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, '');
  }
}

export const lightSpinner = (options?: SpinnerOptions | string): LightSpinner => {
  return new LightSpinner(options);
};

export default lightSpinner;
