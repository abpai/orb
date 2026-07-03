import React from 'react'
import { render } from 'ink'
import { App } from './ui/App'
import { parseCliArgs, DEFAULT_CONFIG } from './config'
import { relaunchOrb } from './services/relaunch'
import { runSessionsCommand } from './sessions-cli'
import { runSetupCommand } from './setup'
import { resolveRuntimeConfig } from './services/runtime-config'
import { createGatewayClient, DEFAULT_SERVER_URL } from './services/gateway-client'
import type { AppConfig } from './types'

export { App } from './ui/App'
export { parseCliArgs, DEFAULT_CONFIG } from './config'
export type { AnthropicModel, AppConfig, LlmModelId, LlmProvider, Voice } from './types'
export { createInitialSession } from './services/runtime-config'

export function warmGatewayForStartup(config: AppConfig): void {
  if (!config.ttsEnabled || config.ttsMode !== 'serve') return

  const signal = AbortSignal.timeout(3000)
  void createGatewayClient(config.ttsServerUrl ?? DEFAULT_SERVER_URL)
    .warmup(signal)
    .catch(() => {})
}

function shouldHandleMetaFlag(args: string[]): boolean {
  return (
    args.includes('--help') ||
    args.includes('-h') ||
    args.includes('--version') ||
    args.includes('-V')
  )
}

export async function run(args: string[]): Promise<void> {
  const command = args[0]
  if (command === 'setup') {
    await runSetupCommand(args.slice(1))
    return
  }
  if (command === 'sessions') {
    await runSessionsCommand(args.slice(1))
    return
  }
  if (shouldHandleMetaFlag(args)) {
    parseCliArgs(args)
    return
  }

  const result = await resolveRuntimeConfig(args)
  if (result.kind === 'error') {
    console.error(result.message)
    process.exit(result.code)
  }

  const { config, initialSession, orbSessionId, resumeInfo } = result
  warmGatewayForStartup(config)

  const instance = render(
    React.createElement(App, {
      config,
      initialSession,
      orbSessionId,
      resumeInfo,
      onRequestRelaunch: (relaunchArgs: string[]) =>
        void relaunchOrb(relaunchArgs, () => instance.unmount()),
    }),
    {
      patchConsole: true,
      concurrent: true,
    },
  )
}
