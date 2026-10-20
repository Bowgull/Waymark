import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import { gotoToday } from './support/helpers'

/**
 * The full Library (page 52) and its content (page 60), approved 2026-10-19:
 * every kind browsable (Techniques and Runs are new), one search across all
 * kinds, and an item page for everything: the cue, up to three tips, a coach
 * hint and a video button that names where it opens, with the coach and the
 * length under it. Videos open outside the app (target _blank).
 */
async function openLibrary(page: Page) {
  await gotoToday(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'library' }).tap()
  await expect(page).toHaveURL(/\/library$/)
}

test('Every kind: Techniques (23) and Runs (7) join the list; the Waybook keeps its lock', async ({ page }) => {
  await openLibrary(page)
  const techniques = page.getByRole('button', { name: 'techniques', exact: true })
  await expect(techniques).toContainText('NEW KIND')
  await expect(techniques).toContainText('23')
  await expect(page.getByRole('button', { name: 'runs', exact: true })).toContainText('7')
  await expect(page.getByRole('button', { name: 'waybook', exact: true }).getByLabel('Locked')).toBeVisible()

  // Techniques: each with its kind and how many combos use it, most used first
  await techniques.tap()
  await expect(page.getByRole('button', { name: /^Jab Punch · in \d+ combos/ })).toBeVisible()
  await page.getByRole('button', { name: /^Rear Roundhouse Kick · in \d+ combos/ }).tap()
  await expect(page).toHaveURL(/open=techniques&item=tech-roundhouse/)
  await expect(page.getByText('Kick · also Right Kick, Body Kick, Rear Kick')).toBeVisible()
  await expect(page.getByText(/^Step out at an angle/)).toBeVisible()
  const watch = page.getByRole('link', { name: 'WATCH ON YOUTUBE' })
  await expect(watch).toHaveAttribute('target', '_blank')
  await expect(watch).toHaveAttribute('href', /youtube\.com/)
  await expect(page.getByText('fightTIPS', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Also on TikTok/ })).toHaveAttribute('href', /tiktok\.com/)
  // back to the list with ‹ TECHNIQUES
  await page.getByRole('button', { name: 'Back to techniques' }).tap()
  await expect(page).toHaveURL(/open=techniques$/)
})

test('An exercise page: the plain cue, three tips, the coach hint, the video with its coach and length (page 60)', async ({ page }) => {
  await openLibrary(page)
  await page.getByRole('button', { name: 'strength', exact: true }).tap()
  await page.getByRole('button', { name: /^Front Squat Barbell/ }).tap()
  await expect(page.getByRole('img', { name: 'FRONT SQUAT' })).toBeVisible()
  await expect(page.getByText('Bar on the front of the shoulders, elbows high. Sit straight down between the hips, then stand up through the whole foot.')).toBeVisible()
  await expect(page.locator('.lib-tips li')).toHaveCount(3)
  await expect(page.locator('.lib-hint b')).toHaveText('Your main squat.')
  await expect(page.getByRole('link', { name: 'WATCH ON YOUTUBE' })).toHaveAttribute('href', 'https://www.youtube.com/shorts/4n9HM7VabC0')
  await expect(page.getByText('Squat University', { exact: true })).toBeVisible()
  await expect(page.getByText(/· 1:00$/)).toBeVisible()
  await expect(page.locator('.lib-vid-bd')).toHaveScreenshot('library-front-squat-video.png')
})

test('A combo page: the cue flap, tips, mastery and its video; a run type page', async ({ page }) => {
  await page.goto('/library?open=bag&item=combo-w10')
  await expect(page.getByRole('img', { name: 'HIP DRIVES THE KNEE' })).toBeVisible()
  await expect(page.getByText('Sharp ratings')).toBeVisible()
  await expect(page.getByText('TAG Muay Thai', { exact: true })).toBeVisible()

  await page.goto('/library?open=runs&item=run-walk')
  await expect(page.getByRole('img', { name: 'RUN-WALK' })).toBeVisible()
  await expect(page.getByText('Run · easy, walks planned in')).toBeVisible()
  await expect(page.getByText('What it is')).toBeVisible()
  await expect(page.getByText('The Running Channel', { exact: true })).toBeVisible()
})

test('One search across every kind, grouped, with counts', async ({ page }) => {
  await openLibrary(page)
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('teep')
  await expect(page.getByRole('button', { name: /^TECHNIQUES · (3 of )?\d+$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Lead Teep / })).toBeVisible()
  const combosHead = page.getByRole('button', { name: /^COMBOS · (3 of \d+|\d+)$/ })
  await expect(combosHead).toBeVisible()
  await expect(page.getByText(/STRENGTH · 0/)).toBeVisible()
  // the header shows them all
  const label = (await combosHead.textContent()) ?? ''
  if (/3 of/.test(label)) {
    await combosHead.tap()
    await expect(page.getByRole('button', { name: /^COMBOS · \d+$/ })).toBeVisible()
  }
  // by muscle too
  await page.getByRole('searchbox', { name: 'Search everything' }).fill('hip')
  await expect(page.getByRole('button', { name: /^FOUNDATION · / })).toBeVisible()
})
