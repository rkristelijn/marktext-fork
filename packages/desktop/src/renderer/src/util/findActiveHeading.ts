/**
 * Given heading entries (slug + offsetTop), return the slug of the last one
 * whose `offsetTop` is at or above `lineTop`, i.e. the active scroll-spy
 * heading. Falls back to the first heading when the line is above all of them.
 * `offsetTop` and `lineTop` must share the same coordinate frame (the caller
 * passes viewport-relative values: each heading's `getBoundingClientRect().top`
 * and the active line near the top of the editor viewport).
 */
export function findActiveHeadingSlug(
  headings: Array<{ slug: string; offsetTop: number }>,
  lineTop: number
): string | null {
  if (headings.length === 0) return null
  let active = headings[0].slug
  for (const h of headings) {
    if (h.offsetTop <= lineTop) {
      active = h.slug
    }
  }
  return active
}
