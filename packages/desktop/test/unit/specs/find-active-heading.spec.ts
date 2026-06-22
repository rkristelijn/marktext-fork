import { describe, it, expect } from 'vitest'
import { findActiveHeadingSlug } from '../../../src/renderer/src/util/findActiveHeading'

describe('findActiveHeadingSlug', () => {
  it('returns null for empty headings', () => {
    expect(findActiveHeadingSlug([], 100)).toBe(null)
  })

  it('returns first heading when cursor is above all headings', () => {
    const headings = [
      { slug: 'intro', offsetTop: 200 },
      { slug: 'body', offsetTop: 400 }
    ]
    expect(findActiveHeadingSlug(headings, 50)).toBe('intro')
  })

  it('returns the last heading at or above cursor position', () => {
    const headings = [
      { slug: 'intro', offsetTop: 100 },
      { slug: 'body', offsetTop: 300 },
      { slug: 'conclusion', offsetTop: 500 }
    ]
    expect(findActiveHeadingSlug(headings, 350)).toBe('body')
  })

  it('returns heading exactly at cursor position', () => {
    const headings = [
      { slug: 'intro', offsetTop: 100 },
      { slug: 'body', offsetTop: 300 }
    ]
    expect(findActiveHeadingSlug(headings, 300)).toBe('body')
  })

  it('returns last heading when cursor is below all', () => {
    const headings = [
      { slug: 'intro', offsetTop: 100 },
      { slug: 'body', offsetTop: 300 }
    ]
    expect(findActiveHeadingSlug(headings, 9999)).toBe('body')
  })

  it('handles single heading', () => {
    const headings = [{ slug: 'only', offsetTop: 50 }]
    expect(findActiveHeadingSlug(headings, 100)).toBe('only')
  })
})
