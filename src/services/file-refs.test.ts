import { describe, expect, it } from 'bun:test'
import {
  parseFileRefs,
  parseExplicitRefs,
  refsFromToolCall,
  collectFocusRefs,
  latestFocusRefs,
} from './file-refs'
import type { HistoryEntry, ToolCall } from '../types'

function toolCall(name: string, input: Record<string, unknown>): ToolCall {
  return { id: name, index: 0, name, input, status: 'complete' }
}

function turn(partial: Partial<HistoryEntry>): HistoryEntry {
  return { id: 't', question: '', toolCalls: [], answer: '', ...partial }
}

describe('parseFileRefs', () => {
  it('extracts bare paths with and without line numbers', () => {
    expect(parseFileRefs('look at src/foo.ts and bar/baz.tsx:42')).toEqual([
      { path: 'src/foo.ts' },
      { path: 'bar/baz.tsx', line: 42 },
    ])
  })

  it('ignores a trailing column number but keeps the line', () => {
    expect(parseFileRefs('see app.ts:10:3 here')).toEqual([{ path: 'app.ts', line: 10 }])
  })

  it('reads markdown link targets and backtick-wrapped paths', () => {
    expect(parseFileRefs('the [adapter](src/openai.ts) and `lib/x.ts:7`')).toEqual([
      { path: 'src/openai.ts' },
      { path: 'lib/x.ts', line: 7 },
    ])
  })

  it('handles relative and home-prefixed paths', () => {
    expect(parseFileRefs('./a/b.tsx ../c.ts ~/d/e.py')).toEqual([
      { path: './a/b.tsx' },
      { path: '../c.ts' },
      { path: '~/d/e.py' },
    ])
  })

  it('strips trailing sentence punctuation', () => {
    expect(parseFileRefs('open src/foo.ts.')).toEqual([{ path: 'src/foo.ts' }])
  })

  it('does not treat prose abbreviations as files', () => {
    expect(parseFileRefs('etc. and so on, e.g. things')).toEqual([])
  })

  it('dedupes by path, upgrading a line-less ref with a later line number', () => {
    expect(parseFileRefs('foo.ts then foo.ts:9')).toEqual([{ path: 'foo.ts', line: 9 }])
  })

  it('returns nothing for empty input', () => {
    expect(parseFileRefs('')).toEqual([])
  })
})

describe('parseExplicitRefs', () => {
  it('accepts extensionless paths the user typed explicitly', () => {
    expect(parseExplicitRefs('Dockerfile Makefile')).toEqual([
      { path: 'Dockerfile' },
      { path: 'Makefile' },
    ])
  })

  it('parses a trailing line number and strips wrapping quotes', () => {
    expect(parseExplicitRefs('`src/foo.ts:42` "bar.ts"')).toEqual([
      { path: 'src/foo.ts', line: 42 },
      { path: 'bar.ts' },
    ])
  })

  it('returns empty for blank input', () => {
    expect(parseExplicitRefs('   ')).toEqual([])
  })
})

describe('refsFromToolCall', () => {
  it('reads file_path from Anthropic/Gemini read & write tools', () => {
    expect(refsFromToolCall(toolCall('Read', { file_path: 'src/a.ts' }))).toEqual([
      { path: 'src/a.ts' },
    ])
  })

  it('reads notebook_path', () => {
    expect(refsFromToolCall(toolCall('NotebookRead', { notebook_path: 'nb.ipynb' }))).toEqual([
      { path: 'nb.ipynb' },
    ])
  })

  it('treats path as a file only when it looks like one', () => {
    expect(refsFromToolCall(toolCall('readFile', { path: 'pkg/x.ts' }))).toEqual([
      { path: 'pkg/x.ts' },
    ])
    expect(refsFromToolCall(toolCall('Grep', { path: 'src/components' }))).toEqual([])
  })

  it('reads Codex fileChange change paths', () => {
    expect(
      refsFromToolCall(
        toolCall('fileChange', { changes: [{ path: 'a.ts' }, { path: 'b.ts' }, {}] }),
      ),
    ).toEqual([{ path: 'a.ts' }, { path: 'b.ts' }])
  })

  it('scans shell command strings for paths', () => {
    expect(refsFromToolCall(toolCall('bash', { command: 'rg foo src/index.ts' }))).toEqual([
      { path: 'src/index.ts' },
    ])
  })
})

describe('collectFocusRefs', () => {
  it('combines answer refs (first) with tool-call refs, deduped', () => {
    const entry = turn({
      answer: 'I edited src/foo.ts and explained bar.ts',
      toolCalls: [
        toolCall('Read', { file_path: 'src/foo.ts' }),
        toolCall('Read', { file_path: 'lib/extra.ts' }),
      ],
    })
    expect(collectFocusRefs(entry)).toEqual([
      { path: 'src/foo.ts' },
      { path: 'bar.ts' },
      { path: 'lib/extra.ts' },
    ])
  })
})

describe('latestFocusRefs', () => {
  it('returns refs from the most recent turn that references files', () => {
    const turns = [turn({ answer: 'old.ts mention' }), turn({ answer: 'nothing here' })]
    expect(latestFocusRefs(turns)).toEqual([{ path: 'old.ts' }])
  })

  it('returns empty when no turn references files', () => {
    expect(latestFocusRefs([turn({ answer: 'just talking' })])).toEqual([])
    expect(latestFocusRefs([])).toEqual([])
  })
})
