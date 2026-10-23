import { test, expect } from './fixtures'

/**
 * Page 74 §1 (approved 2026-10-22): Settings' Connections board holds only the
 * heart rate strap. CONNECT HEART RATE STRAP → searching (the heart shimmers)
 * → "COOSPO H9Z · connected" → tap the row for one small line, FORGET STRAP.
 * The recorder is the web mock (src/lib/runRecorder.ts) here.
 */
test('Settings: connect the heart rate strap, then forget it; no Strava anywhere', async ({ page }) => {
  await page.goto('/settings')
  const board = page.locator('.st-board').filter({ has: page.getByText('Connections', { exact: true }) })
  await expect(board).toBeVisible({ timeout: 20_000 })

  // Only the strap: no Strava, no One Pace / Naruto rows on this board.
  await expect(page.getByText('Strava', { exact: false })).toHaveCount(0)
  await expect(board.getByText('Heart rate strap', { exact: true })).toBeVisible()
  await expect(board.getByText('Not connected.')).toBeVisible()
  await expect(board.getByText('One Pace arc')).toHaveCount(0)
  // The indoor-run rows moved to Training.
  await expect(page.getByText('One Pace arc')).toBeVisible()

  // CONNECT: searching, the heart shimmering, the button gone.
  await board.getByRole('button', { name: 'CONNECT HEART RATE STRAP' }).tap()
  await expect(board.getByText('Looking for it…')).toBeVisible()
  await expect(board.locator('canvas.wm-heart')).toHaveAttribute('data-state', 'search')
  await expect(board.getByRole('button', { name: 'CONNECT HEART RATE STRAP' })).toHaveCount(0)

  // Found: COOSPO H9Z · connected. No heart rate yet, so the heart stays still (audit 2026-10-23 #20).
  await page.clock.fastForward(1800)
  await expect(board.getByText('COOSPO H9Z · connected')).toBeVisible()
  await expect(board.locator('canvas.wm-heart')).toHaveAttribute('data-state', 'idle')
  // The heart container is drawn (canvases are hidden in screenshots): its pixels are there.
  const lit = await board.locator('canvas.wm-heart').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
  expect(lit).toBeGreaterThan(50)
  await expect(board).toHaveScreenshot('strap-connected.png')

  // Remembered after a reload: saved, not live (it links on the next run).
  await page.reload()
  await expect(page.getByText('COOSPO H9Z · saved')).toBeVisible({ timeout: 20_000 })

  // Tap the row: one small line, FORGET STRAP. A tap away closes it.
  const row = page.getByRole('button', { name: /^Heart rate strap, COOSPO H9Z · saved\. Options$/ })
  await row.tap()
  const menu = page.getByRole('menu', { name: 'Heart rate strap' })
  await expect(menu.getByRole('menuitem', { name: 'FORGET STRAP' })).toBeVisible()
  await page.locator('.st-hveil').tap({ position: { x: 10, y: 10 } })
  await expect(menu).toHaveCount(0)
  await expect(page.getByText('COOSPO H9Z · saved')).toBeVisible()

  // FORGET STRAP: back to not connected, the button again.
  await row.tap()
  await page.getByRole('menuitem', { name: 'FORGET STRAP' }).tap()
  await expect(page.getByText('Not connected.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONNECT HEART RATE STRAP' })).toBeVisible()
})

test('Settings: a strap that never answers goes back to CONNECT', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByText('Heart rate strap', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.evaluate(() => (window as unknown as { __wmStrapMock?: { absent(on: boolean): void } }).__wmStrapMock?.absent(true))
  await page.getByRole('button', { name: 'CONNECT HEART RATE STRAP' }).tap()
  await expect(page.getByText('Looking for it…')).toBeVisible()
  await page.clock.fastForward(1800)
  await expect(page.getByText('Not connected.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONNECT HEART RATE STRAP' })).toBeVisible()
})

test('The hidden recorder test screen is gone', async ({ page }) => {
  await page.goto('/dev/recorder')
  await expect(page.getByText('RECORDER')).toHaveCount(0)
  await expect(page).not.toHaveURL(/\/dev\/recorder$/, { timeout: 20_000 })
})
