import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AppConfig, ToolCall } from '../types'

// Voice-aware system prompt for TTS-friendly responses
const VOICE_SYSTEM_PROMPT = `You are a helpful coding assistant responding via voice.

Guidelines for voice responses:
- Keep responses concise: 2-4 sentences for simple questions, up to a paragraph for complex topics
- Use conversational, natural language that sounds good when spoken aloud
- Avoid code blocks, markdown formatting, bullet lists, and technical symbols
- When discussing code, describe it verbally rather than showing syntax
- End with a follow-up question or offer to elaborate if the topic warrants it
- If a question requires showing code, briefly explain what you would write and ask if they'd like details

Remember: Your response will be read aloud, so optimize for listening, not reading.`

// Tools the model can see and use (context restriction)
const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'] as const

// Tools explicitly removed from model context (defense-in-depth)
const DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'TodoWrite'] as const

// Read-only shell commands (filesystem inspection, text processing, system info)
const SAFE_READ_COMMANDS = [
  // Filesystem inspection
  'ls',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'file',
  'stat',
  'wc',
  'find',
  'tree',
  'du',
  'df',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  // Text processing (read-only)
  'grep',
  'sort',
  'uniq',
  'diff',
  'cmp',
  'strings',
  'hexdump',
  'xxd',
  // Environment/system info
  'pwd',
  'echo',
  'which',
  'env',
  'printenv',
  'date',
  'whoami',
  'hostname',
  'uname',
  // Help
  'man',
  'help',
  'type',
]

// Read-only git commands (checked as prefix match)
const SAFE_GIT_COMMANDS = [
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'git remote',
  'git tag',
  'git rev-parse',
  'git ls-files',
  'git blame',
]

// Patterns that indicate destructive operations (hard deny)
const DESTRUCTIVE_PATTERNS = [
  /\brm\s/,
  /\bsudo\b/,
  // Shell redirection: match > or >> followed by path-like target (not inside quotes)
  // Catches: > file, >> file, >./path, >/path, >~/path
  // Avoids: grep '>' file, echo ">" (quoted > characters)
  /(?<!['"'])\s*>{1,2}\s*[/~.\w]/,
  /\bmkdir\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bmv\b/,
  /\bcp\b/,
  /\btouch\b/,
  /\bln\b/,
]

export interface AgentCallbacks {
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (index: number, result: string) => void
  onAssistantText?: (text: string) => void
  onSessionId?: (sessionId: string) => void
}

type TextBlock = { type: 'text'; text: string }

function isTextBlock(value: unknown): value is TextBlock {
  return typeof value === 'object' && value !== null && (value as TextBlock).type === 'text'
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content.filter(isTextBlock).map((c) => c.text).join('')
  }
  return ''
}

export async function runAgent(
  prompt: string,
  config: AppConfig,
  sessionId: string | undefined,
  callbacks: AgentCallbacks,
): Promise<string> {
  let toolIndex = 0
  let finalResult = ''
  // Map tool_use_id to sequential index for result correlation
  const toolIdToIndex = new Map<string, number>()

  const response = query({
    prompt,
    options: {
      cwd: config.projectPath,
      model: config.model,
      maxTurns: 10,
      resume: sessionId,
      permissionMode: config.permissionMode,
      // Inject voice-aware system prompt when TTS is enabled
      ...(config.ttsEnabled && { systemPrompt: VOICE_SYSTEM_PROMPT }),
      // Context restriction: only these tools exist for the model
      tools: [...ALLOWED_TOOLS],
      // Auto-approve all allowed tools (no permission prompts)
      allowedTools: [...ALLOWED_TOOLS],
      // Belt-and-suspenders: explicitly block write tools
      disallowedTools: [...DISALLOWED_TOOLS],
      canUseTool: async (toolName, input) => {
        // Extra safety: deny write operations even if they somehow get through
        if (DISALLOWED_TOOLS.includes(toolName as (typeof DISALLOWED_TOOLS)[number])) {
          return { behavior: 'deny', message: 'Read-only mode: write operations disabled' }
        }

        if (toolName === 'Bash') {
          const cmd = ((input as Record<string, unknown>).command as string).trim()

          // Hard deny destructive patterns
          if (DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd))) {
            return { behavior: 'deny', message: 'Destructive command blocked' }
          }

          // Allow safe git commands (prefix match)
          if (SAFE_GIT_COMMANDS.some((safe) => cmd.startsWith(safe))) {
            return { behavior: 'allow' }
          }

          // Allow safe single commands
          const firstWord = cmd.split(/\s+/)[0] ?? ''
          if (SAFE_READ_COMMANDS.includes(firstWord)) {
            return { behavior: 'allow' }
          }

          // Deny unknown commands
          return {
            behavior: 'deny',
            message: `Command not in safe list: "${firstWord}"`,
          }
        }

        return { behavior: 'allow' }
      },
    },
  })

  for await (const message of response) {
    if (message.type === 'system' && message.subtype === 'init') {
      callbacks.onSessionId?.(message.session_id)
    }

    if (message.type === 'assistant') {
      const content = message.message.content

      for (const block of content) {
        if (block.type === 'tool_use') {
          const currentIndex = toolIndex++
          // Support both 'id' and 'tool_use_id' field names (SDK may use either)
          const blockAny = block as Record<string, unknown>
          const toolId = (blockAny.id ?? blockAny.tool_use_id) as string | undefined
          // Store mapping from tool_use_id to index for result correlation
          if (toolId) {
            toolIdToIndex.set(toolId, currentIndex)
          }
          const call: ToolCall = {
            id: toolId ?? `tool-${currentIndex}`,
            index: currentIndex,
            name: block.name,
            input: block.input as Record<string, unknown>,
            status: 'running',
          }
          callbacks.onToolCall?.(call)
        } else if (block.type === 'text' && block.text) {
          callbacks.onAssistantText?.(block.text)
        }
      }
    }

    if (message.type === 'user') {
      const content = message.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const resultText = extractToolResultText(block.content)

            // Correlate result to tool call by ID (handles parallel tool calls correctly)
            const idx = toolIdToIndex.get(block.tool_use_id)
            if (idx !== undefined) {
              callbacks.onToolResult?.(idx, resultText.slice(0, 200))
            }
          }
        }
      }
    }

    if (message.type === 'result' && message.subtype === 'success') {
      finalResult = message.result
    }
  }

  return finalResult
}
