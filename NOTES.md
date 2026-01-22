# Implementation Notes & Lessons Learned

Notes from building the Voice-Driven Code Explorer with Claude Agent SDK, Ink, and pocket-tts.

## Claude Agent SDK

### Package Name Change
The SDK was renamed from `@anthropic-ai/claude-code-sdk` to `@anthropic-ai/claude-agent-sdk`. The old name returns a 404 on npm.

### Permission Result Types
The `canUseTool` callback only accepts `'allow'` or `'deny'` behaviors - **not `'ask'`**:

```typescript
// ❌ Won't compile - 'ask' is not a valid behavior
return { behavior: 'ask', message: 'Allow this?' }

// ✅ Correct - only 'allow' or 'deny'
return { behavior: 'deny', message: 'Command not in safe list' }
```

If you want interactive permission prompts, handle that logic within the callback before returning.

### Result Message Types
`SDKResultMessage` is a union of `SDKResultSuccess` and `SDKResultError`. The `result` field only exists on success:

```typescript
// ❌ Won't compile - result doesn't exist on error type
if (message.type === 'result') {
  finalResult = message.result ?? ''
}

// ✅ Check subtype first
if (message.type === 'result' && message.subtype === 'success') {
  finalResult = message.result
}
```

### Session Continuity
To maintain conversation context across queries, capture the `session_id` from the `system` init message and pass it via the `resume` option:

```typescript
const sessionIdRef = useRef<string | undefined>(undefined)

// Capture session ID
if (message.type === 'system' && message.subtype === 'init') {
  sessionIdRef.current = message.session_id
}

// Use it in subsequent queries
const response = query({
  prompt,
  options: {
    resume: sessionIdRef.current,  // Continues the conversation
    // ...
  }
})
```

## Ink (React for Terminals)

### @inkjs/ui TextInput is Uncontrolled
The `TextInput` from `@inkjs/ui` v2 uses `defaultValue`, not `value`. It's uncontrolled:

```typescript
// ❌ These props don't exist
<TextInput value={input} onChange={setInput} />

// ✅ Correct API
<TextInput
  defaultValue=""
  onChange={(value) => ...}
  onSubmit={(value) => ...}
/>
```

For full control, use Ink's `useInput` hook to build a custom input component.

### useInput Hook Pattern
When building custom input components, `useInput` provides raw keyboard events:

```typescript
useInput(
  (input, key) => {
    if (key.return) {
      onSubmit(value)
      return
    }
    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setValue(v => v + input)
    }
  },
  { isActive: !disabled }  // Disable when processing
)
```

### Raw Mode Requirement
Ink requires raw mode for input handling. This fails in non-TTY environments (CI, piped input, `timeout` command):

```
ERROR Raw mode is not supported on the current process.stdin
```

This is expected - the app needs a real terminal. Test manually, not via `timeout`.

### Static Component Gotcha
`<Static>` renders content **outside** the normal Ink component tree at the top of terminal output. It's designed for persistent logs that shouldn't re-render (like build output), but this breaks expected layouts:

```tsx
// ❌ Tool calls appear at top of screen, detached from header
<Box flexDirection="column">
  <Text>─── Tool Calls ───</Text>
  <Static items={toolCalls}>
    {(call) => <ToolCallItem key={call.id} call={call} />}
  </Static>
</Box>

// ✅ Use regular Box + map for content that should stay in place
<Box flexDirection="column">
  <Text>─── Tool Calls ───</Text>
  <Box flexDirection="column">
    {toolCalls.map((call) => (
      <ToolCallItem key={call.id} call={call} />
    ))}
  </Box>
</Box>
```

Only use `<Static>` for true log-style output where top-of-screen positioning is intentional.

## TypeScript Strictness

### noUncheckedIndexedAccess
With `noUncheckedIndexedAccess: true`, array access returns `T | undefined`:

```typescript
// ❌ Error: 'arg' is possibly undefined
const arg = args[i]
if (arg.startsWith('--')) { ... }

// ✅ Use for...of or check explicitly
for (const arg of args) {
  if (arg.startsWith('--')) { ... }
}

// ✅ Or provide fallback
const firstWord = cmd.split(/\s+/)[0] ?? ''
```

### useRef Requires Initial Value
With strict mode, `useRef<T>()` without an argument errors:

```typescript
// ❌ Error: Expected 1 argument
const ref = useRef<string | undefined>()

// ✅ Provide initial value
const ref = useRef<string | undefined>(undefined)
```

### JSX Configuration
For React JSX in TypeScript, add to `tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["bun", "react"]
  }
}
```

## TTS Integration

### Sentence Chunking
Long text should be split at sentence boundaries for natural speech. The naive approach of speaking everything at once creates awkward pauses:

```typescript
function splitIntoSentences(text: string): string[] {
  // Split on . ! ? followed by space or end
  // Handle edge cases like "Dr." or "3.14"
}
```

### Markdown Cleanup
Strip markdown before TTS - code blocks and formatting characters sound terrible:

```typescript
function cleanTextForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')  // Code blocks
    .replace(/`[^`]+`/g, ' code ')                // Inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // Links → text only
    .replace(/[#*_~]/g, '')                       // Formatting chars
}
```

### Process Cleanup
Always clean up temp audio files, even on error:

```typescript
try {
  await generateAudio(sentence, voice, audioPath)
  await playAudio(audioPath)
} finally {
  await unlink(audioPath).catch(() => {})  // Ignore cleanup errors
}
```

## ESLint Configuration

### Console Statement Rules
The project ESLint config restricts `console.log` but allows `console.info`, `console.warn`, `console.error`:

```typescript
// ❌ Lint error
console.log('Starting...')

// ✅ Allowed
console.info('Starting...')
```

## General Patterns

### Callback-Based State Updates
When processing streamed messages, use callback-based setState to avoid stale closures:

```typescript
// ❌ May use stale state
setToolCalls([...toolCalls, newCall])

// ✅ Always gets latest state
setToolCalls(prev => [...prev, newCall])
```

### Type Guards for Union Types
SDK messages are unions. Use type guards to narrow:

```typescript
// Generic approach for content blocks
.filter(
  (c: unknown): c is { type: 'text'; text: string } =>
    typeof c === 'object' &&
    c !== null &&
    (c as Record<string, unknown>).type === 'text'
)
```
