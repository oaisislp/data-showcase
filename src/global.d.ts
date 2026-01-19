export {};

declare global {
  interface Window {
    dataWorkbench?: {
      runShell: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;
      runPython: (code: string) => Promise<{ code: number; stdout: string; stderr: string }>;
      runNode: (code: string) => Promise<{ code: number; stdout: string; stderr: string }>;
      openFile: () => Promise<string | null>;
    };
  }
}
