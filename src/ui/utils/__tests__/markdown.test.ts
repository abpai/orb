import { describe, expect, it } from 'bun:test'
import { cleanTextForSpeech, stripMarkdown } from '../markdown'

describe('cleanTextForSpeech', () => {
  describe('code block handling', () => {
    it('replaces complete code blocks with placeholder', () => {
      const input = 'Here is some code:\n```\nconst x = 1\n```\nEnd.'
      expect(cleanTextForSpeech(input)).toBe('Here is some code: code block End.')
    })

    it('replaces inline code with placeholder', () => {
      const input = 'Use `useState` for state'
      expect(cleanTextForSpeech(input)).toBe('Use code for state')
    })

    it('handles multiple inline codes', () => {
      const input = 'Use `foo` and `bar` together'
      expect(cleanTextForSpeech(input)).toBe('Use code and code together')
    })
  })

  describe('unmatched delimiter handling', () => {
    it('preserves text after unmatched single backtick with placeholder', () => {
      const input = 'Hello `code without close'
      // When delimiter is unmatched, replacement is added and remaining text preserved
      expect(cleanTextForSpeech(input)).toBe('Hello code code without close')
    })

    it('preserves text after unmatched triple backtick with placeholder', () => {
      const input = 'Text ```incomplete code block'
      expect(cleanTextForSpeech(input)).toBe('Text code block incomplete code block')
    })

    it('handles unmatched backtick at end with placeholder', () => {
      const input = 'Some text `'
      expect(cleanTextForSpeech(input)).toBe('Some text code')
    })

    it('handles unmatched triple backtick at end with placeholder', () => {
      const input = 'Some text ```'
      expect(cleanTextForSpeech(input)).toBe('Some text code block')
    })

    it('handles unmatched backtick with text after', () => {
      const input = 'Before `after the backtick here'
      expect(cleanTextForSpeech(input)).toBe('Before code after the backtick here')
    })
  })

  describe('nested and complex delimiters', () => {
    it('handles backticks inside code blocks', () => {
      const input = 'Look at this:\n```\nconst s = `template`\n```\nDone.'
      expect(cleanTextForSpeech(input)).toBe('Look at this: code block Done.')
    })

    it('handles empty content between delimiters', () => {
      const input = 'Empty `` code'
      expect(cleanTextForSpeech(input)).toBe('Empty code code')
    })

    it('handles empty code block', () => {
      const input = 'Empty block:\n``````\nAfter'
      expect(cleanTextForSpeech(input)).toBe('Empty block: code block After')
    })
  })

  describe('whitespace normalization', () => {
    it('collapses multiple spaces', () => {
      const input = 'Too   many    spaces'
      expect(cleanTextForSpeech(input)).toBe('Too many spaces')
    })

    it('collapses newlines into spaces', () => {
      const input = 'Line one\nLine two\nLine three'
      expect(cleanTextForSpeech(input)).toBe('Line one Line two Line three')
    })

    it('trims leading and trailing whitespace', () => {
      const input = '  Surrounded by space  '
      expect(cleanTextForSpeech(input)).toBe('Surrounded by space')
    })
  })
})

describe('stripMarkdown', () => {
  it('removes header markers', () => {
    expect(stripMarkdown('# Heading')).toBe('Heading')
    expect(stripMarkdown('## Subheading')).toBe('Subheading')
    expect(stripMarkdown('### Level 3')).toBe('Level 3')
  })

  it('removes bold markers', () => {
    expect(stripMarkdown('This is **bold** text')).toBe('This is bold text')
    expect(stripMarkdown('This is __bold__ text')).toBe('This is bold text')
  })

  it('removes italic markers', () => {
    expect(stripMarkdown('This is *italic* text')).toBe('This is italic text')
    expect(stripMarkdown('This is _italic_ text')).toBe('This is italic text')
  })

  it('removes link syntax keeping text', () => {
    expect(stripMarkdown('[link text](https://example.com)')).toBe('link text')
  })

  it('preserves code blocks', () => {
    expect(stripMarkdown('Some `code` here')).toBe('Some `code` here')
    expect(stripMarkdown('```\nblock\n```')).toBe('```\nblock\n```')
  })

  it('removes blockquote markers', () => {
    expect(stripMarkdown('> Quoted text')).toBe('Quoted text')
  })

  it('removes list markers', () => {
    expect(stripMarkdown('- Item one')).toBe('Item one')
    expect(stripMarkdown('* Item two')).toBe('Item two')
    expect(stripMarkdown('1. First item')).toBe('First item')
  })
})
