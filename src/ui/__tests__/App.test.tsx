import { describe, expect, it } from 'bun:test'

import { isInputDisabled } from '../App'

describe('App', () => {
  it('disables the input prompt for every non-idle state', () => {
    expect(isInputDisabled('idle')).toBe(false)
    expect(isInputDisabled('processing')).toBe(true)
    expect(isInputDisabled('processing_speaking')).toBe(true)
    expect(isInputDisabled('speaking')).toBe(true)
  })
})
