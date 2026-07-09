import { spawn } from "child_process";

export interface ProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Called with the spawned process so callers can cancel/kill it. */
  onStart?: (kill: () => void) => void;
}

/**
 * Runs a command, capturing stdout/stderr. Never rejects — failures are
 * reported via exitCode/stderr, mirroring the IntelliJ CapturingProcessHandler
 * behaviour used by the SDK executor.
 */
export function runProcess(command: string, args: string[], opts: ExecOptions = {}): Promise<ProcessOutput> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        shell: false,
      });
    } catch (e) {
      resolve({ exitCode: -1, stdout: "", stderr: e instanceof Error ? e.message : String(e), timedOut: false });
      return;
    }

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }, opts.timeoutMs)
      : undefined;

    if (opts.onStart) {
      opts.onStart(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      });
    }

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: stderr || err.message, timedOut });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}
