import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const cssPath = path.resolve(process.cwd(), 'src/pages/TodayWorkout.module.css')

test('visual-scaffold: today workout css keeps safe-area and fixed action guards', () => {
  const css = fs.readFileSync(cssPath, 'utf8')
  assert.ok(css.includes('env(safe-area-inset-bottom'), 'safe-area inset should be used for mobile bottom overlap')
  assert.ok(css.includes('.actions'), 'actions block should exist for regression checks')
  assert.ok(css.includes('position: fixed'), 'actions should remain fixed to preserve tap ergonomics')
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

