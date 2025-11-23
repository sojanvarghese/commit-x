declare global {
  let process: {
    env: { [key: string]: string | undefined };
    stdin: { isTTY?: boolean };
    argv: string[];
    exit(code?: number): never;
  };
  let console: {
    log(...args: any[]): void;
    error(...args: any[]): void;
    warn(...args: any[]): void;
  };
}

// Node.js built-in modules
declare module "fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options?: { recursive: boolean }
  ): void;
}

declare module "path" {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module "url" {
  export function fileURLToPath(url: string): string;
}

declare module "os" {
  export function homedir(): string;
}

declare module "process" {
  const process: {
    env: { [key: string]: string | undefined };
    stdin: { isTTY?: boolean };
    argv: string[];
    exit(code?: number): never;
  };
  export default process;
}

declare module "simple-git" {
  export interface SimpleGit {
    status(): Promise<any>;
    diff(args?: string[]): Promise<string>;
    diffSummary(args?: string[]): Promise<any>;
    add(files: string | string[]): Promise<void>;
    commit(message: string): Promise<any>;
    log(options?: { maxCount: number }): Promise<any>;
    getRemotes(verbose?: boolean): Promise<any[]>;
  }

  export interface DiffResult {
    files: Array<{
      file: string;
      insertions: number;
      deletions: number;
    }>;
  }

  export default function simpleGit(): SimpleGit;
}

declare module "commander" {
  export class Command {
    name(name: string): this;
    description(description: string): this;
    version(version: string): this;
    command(name: string): Command;
    alias(alias: string): this;
    option(option: string, description?: string, defaultValue?: any): this;
    action(fn: (...args: any[]) => void | Promise<void>): this;
    parse(argv: string[]): this;
    on(event: string, callback: (...args: any[]) => void): this;
    args: string[];
  }
}
