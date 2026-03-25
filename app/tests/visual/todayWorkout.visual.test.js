import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const cssPath = path.resolve(process.cwd(), 'src/pages/TodayWorkout.module.css')
const pagePath = path.resolve(process.cwd(), 'src/pages/TodayWorkout.tsx')

test('visual-scaffold: today workout css keeps safe-area and fixed action guards', () => {
  const css = fs.readFileSync(cssPath, 'utf8')
  assert.ok(css.includes('env(safe-area-inset-bottom'), 'safe-area inset should be used for mobile bottom overlap')
  assert.ok(css.includes('.actions'), 'actions block should exist for regression checks')
  assert.ok(css.includes('position: fixed'), 'actions should remain fixed to preserve tap ergonomics')
})

test('layout-contract: today page uses single shell state handling', () => {
  const page = fs.readFileSync(pagePath, 'utf8')
  assert.ok(page.includes('const renderStatePanel = () => {'), 'single-shell state panel renderer should exist')
  const weeklyOnce =
    page.includes('const weeklyPlanInspector = renderWeeklyPlanCards()') ||
    /const\s+weeklyPlanInspector\s*=\s*isWeekPage\s*\?\s*renderWeeklyPlanCards\(\)\s*:\s*null/.test(page)
  assert.ok(weeklyOnce, 'weekly inspector should be computed once per render (not inlined repeatedly in JSX)')
  assert.ok(!page.includes("if (viewState === 'loading') {\n    return ("), 'top-level loading return branch should not exist')
  assert.ok(!page.includes("if (viewState === 'error') {\n    return ("), 'top-level error return branch should not exist')
})

test('layout-contract: today css defines stable placeholder geometry', () => {
  const css = fs.readFileSync(cssPath, 'utf8')
  assert.ok(css.includes('.statePanelSlot'), 'state slot should reserve panel height')
  assert.ok(css.includes('.sectionSkeleton'), 'section skeleton class should exist')
  assert.ok(css.includes('.exerciseListSkeleton'), 'exercise list placeholder should reserve vertical area')
  assert.ok(css.includes('.reviewSkeleton'), 'review placeholder should reserve vertical area')
})

test('visual-scaffold: optional playwright screenshot smoke test', async (t) => {
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    t.skip('playwright is not installed; screenshot smoke test skipped')
    return
  }

  const { chromium } = playwright
  const baseUrl = process.env.VISUAL_BASE_URL
  if (!baseUrl) {
    t.skip('VISUAL_BASE_URL not set')
    return
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`${baseUrl}/today`, { waitUntil: 'networkidle' })
    const screenshot = await page.screenshot({ fullPage: true })
    assert.ok(screenshot.byteLength > 0, 'screenshot should contain bytes')
  } finally {
    await browser.close()
  }
})

