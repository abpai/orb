export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOpts {
  cwd?: string;
  signal?: AbortSignal;
}

export interface ReadOpts {
  signal?: AbortSignal;
}

export interface WriteOpts {
  signal?: AbortSignal;
}

export interface Sandbox extends AsyncDisposable {
  readonly rootDir: string;
  exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  readFile(relPath: string, opts?: ReadOpts): Promise<string>;
  writeFile(relPath: string, content: string, opts?: WriteOpts): Promise<void>;
  dispose(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export class PathEscapeError extends Error {
  readonly code = 'PATH_ESCAPE' as const;
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

export class SandboxAbortError extends Error {
  readonly code = 'SANDBOX_ABORT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SandboxAbortError';
  }
}

export class SandboxIoError extends Error {
  readonly code = 'SANDBOX_IO' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SandboxIoError';
  }
}
