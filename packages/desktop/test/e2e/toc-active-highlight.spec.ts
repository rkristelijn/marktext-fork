import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, clickMenuById, waitForEditor } from './helpers'

// Active-heading highlight (scroll-spy). Jocs asked for an e2e that proves the
// highlight reacts; this guards three behaviors that unit tests on the pure
// findActiveHeadingSlug cannot cover end-to-end:
//   1. a section is active as soon as the file opens (seed),
//   2. scrolling moves the highlight to the heading at the top of the editor,
//   3. clicking a TOC entry highlights that entry.
// The doc uses 20 top-level headings with tall filler so each heading needs a
// real scroll to reach the top — the same shape as toc-scroll.spec.ts.
const HEADING_COUNT = 20
const buildLongDoc = (): string => {
  const parts: string[] = []
  for (let i = 1; i <= HEADING_COUNT; i++) {
    parts.push(`# Heading Number ${i}`)
    for (let p = 0; p < 6; p++) {
      parts.push(`Filler paragraph ${p} under heading ${i}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`)
    }
  }
  return parts.join('\n\n') + '\n'
}

// Text of the currently highlighted (is-current) TOC node, or '' when none.
// Scopes the label to the node's OWN content row (`> .el-tree-node__content`)
// so a nested child's label can't leak in.
const activeTocLabel = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.querySelector(
      '.side-bar-toc .el-tree-node.is-current > .el-tree-node__content .el-tree-node__label'
    )
    return (el?.textContent || '').trim()
  })

// Index (in document order, among `.mu-container > hN`) of the heading whose
// clean text matches `text`. The live ATX heading renders its `# ` marker in
// textContent, so strip leading `#`/space before comparing.
const headingIndexByText = (page: Page, text: string): Promise<number> =>
  page.evaluate((needle) => {
    const sel = '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'
    const headings = Array.from(document.querySelectorAll(sel))
    const normalize = (s: string) => s.replace(/^[#\s]+/, '').trim()
    return headings.findIndex((h) => normalize(h.textContent || '') === needle)
  }, text)

// Scroll the editor so the heading at `index` sits just below the editor's top
// edge — i.e. on the TOC active line the scroll-spy reads. Setting scrollTop
// fires a real `scroll` event, which is what drives updateActiveHeading.
const scrollHeadingToActiveLine = (page: Page, index: number): Promise<void> =>
  page.evaluate((idx) => {
    const container = document.querySelector('.editor-component') as HTMLElement | null
    const sel = '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'
    const headings = Array.from(document.querySelectorAll(sel))
    const target = headings[idx] as HTMLElement | undefined
    if (!container || !target) return
    const cTop = container.getBoundingClientRect().top
    const hTop = target.getBoundingClientRect().top
    // +13 puts the heading a hair past the active line (offset 12), so it counts.
    container.scrollTop = container.scrollTop + (hTop - cTop) - 13
  }, index)

const tocLabel = (page: Page, text: string) =>
  page.locator('.side-bar-toc').getByText(text, { exact: true })

const showSidebar = async(app: ElectronApplication, page: Page): Promise<void> => {
  const visible = await page.evaluate(() => {
    const el = document.querySelector('.side-bar') as HTMLElement | null
    return !!(el && el.offsetParent !== null)
  })
  if (!visible) {
    await clickMenuById(app, 'sideBarMenuItem')
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.side-bar') as HTMLElement | null
        return !!(el && el.offsetParent !== null)
      },
      null,
      { timeout: 5000 }
    )
  }
}

test.describe('TOC active-heading highlight (scroll-spy)', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown(buildLongDoc())
    app = launched.app
    page = launched.page
    await waitForEditor(page)
    await showSidebar(app, page)
    await clickMenuById(app, 'tocMenuItem')
    await page.waitForSelector('.side-bar-toc .el-tree', { state: 'visible', timeout: 10000 })
    await page.waitForFunction(
      (count) => document.querySelectorAll('.side-bar-toc .el-tree-node__label').length >= count,
      HEADING_COUNT,
      { timeout: 10000 }
    )
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('the first heading is highlighted as soon as the document opens', async() => {
    await page.evaluate(() => {
      const el = document.querySelector('.editor-component') as HTMLElement | null
      if (el) el.scrollTop = 0
    })
    await expect.poll(() => activeTocLabel(page), { timeout: 8000 }).toBe('Heading Number 1')
  })

  test('scrolling moves the highlight to the heading at the top of the editor', async() => {
    const targetText = 'Heading Number 8'
    const targetIndex = await headingIndexByText(page, targetText)
    expect(targetIndex).toBeGreaterThanOrEqual(0)

    await scrollHeadingToActiveLine(page, targetIndex)
    await expect.poll(() => activeTocLabel(page), { timeout: 8000 }).toBe(targetText)
  })

  test('clicking a TOC entry highlights that entry', async() => {
    const targetText = 'Heading Number 14'
    await tocLabel(page, targetText).click()
    await expect.poll(() => activeTocLabel(page), { timeout: 8000 }).toBe(targetText)
  })
})
