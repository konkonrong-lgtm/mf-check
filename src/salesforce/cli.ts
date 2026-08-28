import { execFileSync } from 'node:child_process';

export function runSfJson(args: string[]) {
  const command =
    process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'sf';

  const commandArgs =
    process.platform === 'win32' ? ['/d', '/s', '/c', 'sf', ...args] : args;

  const output = execFileSync(command, commandArgs, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return JSON.parse(output);
}
