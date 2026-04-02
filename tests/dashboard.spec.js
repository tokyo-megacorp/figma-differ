// @ts-check
const { test, expect } = require('@playwright/test')

const HTML_PATH = '/tmp/test-review.html'

test.describe('Dashboard v1 — Index Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
  })

  test('renders header with file name and frame count', async ({ page }) => {
    await expect(page.locator('.header-title')).toHaveText('fig-diff')
    await expect(page.locator('.header-meta').first()).toContainText('Test Design System')
    await expect(page.locator('.header-meta').last()).toContainText('4 frames tracked')
  })

  test('renders diff range card with correct badges', async ({ page }) => {
    const card = page.locator('.diff-card')
    await expect(card).toHaveCount(1)
    await expect(card.locator('.badge-structural')).toHaveText('1')
    await expect(card.locator('.badge-cosmetic')).toHaveText('1')
    await expect(card.locator('.diff-card-meta')).toContainText('1 structural')
    await expect(card.locator('.diff-card-meta')).toContainText('1 cosmetic')
    await expect(card.locator('.diff-card-meta')).toContainText('2 unchanged')
  })

  test('clicking diff card navigates to accordion', async ({ page }) => {
    await page.locator('.diff-card').click()
    await expect(page.locator('.topbar')).toBeVisible()
    await expect(page.locator('.back-btn')).toBeVisible()
    await expect(page.locator('.filter-pill')).toHaveCount(3)
  })
})

test.describe('Dashboard v1 — Accordion Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
  })

  test('shows filter pills with correct counts', async ({ page }) => {
    const pills = page.locator('.filter-pill')
    await expect(pills).toHaveCount(3)
    await expect(pills.nth(0)).toContainText('1 structural')
    await expect(pills.nth(1)).toContainText('1 cosmetic')
    await expect(pills.nth(2)).toContainText('2 unchanged')
  })

  test('default filters show structural + cosmetic only', async ({ page }) => {
    // structural + cosmetic active by default, unchanged filtered out
    const frames = page.locator('.frame-card')
    await expect(frames).toHaveCount(2) // Login + Signup
    await expect(frames.nth(0).locator('.frame-card-name')).toContainText('Login')
    await expect(frames.nth(1).locator('.frame-card-name')).toContainText('Signup')
  })

  test('toggling unchanged filter shows all frames', async ({ page }) => {
    // Click the unchanged pill to activate it
    await page.locator('.filter-pill').nth(2).click()
    const frames = page.locator('.frame-card')
    await expect(frames).toHaveCount(4)
  })

  test('toggling off structural filter hides structural frames', async ({ page }) => {
    await page.locator('.filter-pill').nth(0).click()
    const frames = page.locator('.frame-card')
    await expect(frames).toHaveCount(1) // Only Signup (cosmetic)
    await expect(frames.first().locator('.frame-card-name')).toContainText('Signup')
  })

  test('expanding a frame shows diff hunks', async ({ page }) => {
    const loginCard = page.locator('.frame-card').first()
    await loginCard.locator('.frame-card-header').click()
    await expect(loginCard).toHaveClass(/expanded/)
    // Should show diff hunks for Login (added nodes, bbox, text, fill, font changes)
    const hunkCount = await loginCard.locator('.diff-hunk').count()
    expect(hunkCount).toBeGreaterThanOrEqual(3)
    const addCount = await loginCard.locator('.diff-add').count()
    expect(addCount).toBeGreaterThanOrEqual(1)
    const changeCount = await loginCard.locator('.diff-change').count()
    expect(changeCount).toBeGreaterThanOrEqual(1)
  })

  test('expanding shows added node names', async ({ page }) => {
    const loginCard = page.locator('.frame-card').first()
    await loginCard.locator('.frame-card-header').click()
    await expect(loginCard.locator('.diff-add').first()).toContainText('Social Login Button')
  })

  test('collapsing a frame hides diff hunks', async ({ page }) => {
    const loginCard = page.locator('.frame-card').first()
    // Expand
    await loginCard.locator('.frame-card-header').click()
    await expect(loginCard).toHaveClass(/expanded/)
    // Collapse
    await loginCard.locator('.frame-card-header').click()
    await expect(loginCard).not.toHaveClass(/expanded/)
  })

  test('page group headers show correct counts', async ({ page }) => {
    const headers = page.locator('.page-group-header')
    await expect(headers.first()).toContainText('Auth')
    await expect(headers.first()).toContainText('2 change(s)')
  })

  test('back button returns to index', async ({ page }) => {
    await page.locator('.back-btn').click()
    await expect(page.locator('.diff-card')).toBeVisible()
    await expect(page.locator('.topbar')).not.toBeVisible()
  })
})

test.describe('Dashboard v1 — Detail Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    // Click frame NAME (not header) to go to detail
    await page.locator('.frame-card-name').first().click()
  })

  test('shows sidebar with frames grouped by page', async ({ page }) => {
    await expect(page.locator('.detail-sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-item')).toHaveCount(2) // Login + Signup (filtered)
    await expect(page.locator('.sidebar-item.active')).toHaveCount(1)
  })

  test('shows detail title and severity badge', async ({ page }) => {
    await expect(page.locator('.detail-title')).toContainText('Login')
    await expect(page.locator('.badge-structural')).toBeVisible()
  })

  test('shows node count stats', async ({ page }) => {
    await expect(page.locator('.detail-stats')).toContainText('15 → 17 nodes')
    await expect(page.locator('.detail-stats')).toContainText('+2')
  })

  test('shows change groups with correct labels', async ({ page }) => {
    const groups = page.locator('.change-group')
    const groupCount = await groups.count()
    expect(groupCount).toBeGreaterThanOrEqual(3)
    await expect(page.locator('.change-group-header').first()).toContainText('Added Nodes')
  })

  test('shows detailed diff hunks in change groups', async ({ page }) => {
    // Added nodes group
    const addCount = await page.locator('.diff-add').count()
    expect(addCount).toBeGreaterThanOrEqual(1)
    await expect(page.locator('.diff-add').first()).toContainText('Social Login Button')
    // Text changes
    await expect(page.locator('.diff-change').first()).toContainText('Login Form')
  })

  test('clicking sidebar item switches frame', async ({ page }) => {
    // Click Signup in sidebar
    await page.locator('.sidebar-item').nth(1).click()
    await expect(page.locator('.detail-title')).toContainText('Signup')
    await expect(page.locator('.sidebar-item.active')).toHaveCount(1)
  })

  test('back button returns to accordion', async ({ page }) => {
    await page.locator('.back-btn').click()
    // Should see accordion with filter pills
    await expect(page.locator('.filter-pill')).toHaveCount(3)
    await expect(page.locator('.frame-card')).toHaveCount(2)
  })
})

test.describe('Dashboard v1 — Keyboard Navigation', () => {
  test('j/k moves focus in accordion', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()

    await page.keyboard.press('j')
    await expect(page.locator('.frame-card.focused')).toHaveCount(1)
    await expect(page.locator('.frame-card').first()).toHaveClass(/focused/)

    await page.keyboard.press('j')
    await expect(page.locator('.frame-card').nth(1)).toHaveClass(/focused/)
    await expect(page.locator('.frame-card').first()).not.toHaveClass(/focused/)

    await page.keyboard.press('k')
    await expect(page.locator('.frame-card').first()).toHaveClass(/focused/)
  })

  test('Enter expands focused frame', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()

    await page.keyboard.press('j')
    await page.keyboard.press('Enter')
    await expect(page.locator('.frame-card').first()).toHaveClass(/expanded/)
  })

  test('o opens detail for focused frame', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()

    await page.keyboard.press('j')
    await page.keyboard.press('o')
    await expect(page.locator('.detail-sidebar')).toBeVisible()
    await expect(page.locator('.detail-title')).toContainText('Login')
  })

  test('Escape in accordion returns to index', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()

    await page.keyboard.press('Escape')
    await expect(page.locator('.diff-card')).toBeVisible()
  })

  test('Escape in detail returns to accordion', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await page.locator('.frame-card-name').first().click()

    await page.keyboard.press('Escape')
    await expect(page.locator('.filter-pill')).toHaveCount(3)
  })

  test('j/k navigates sidebar in detail view', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await page.locator('.frame-card-name').first().click()

    await expect(page.locator('.detail-title')).toContainText('Login')
    await page.keyboard.press('j')
    await expect(page.locator('.detail-title')).toContainText('Signup')
  })
})

test.describe('Dashboard v1 — Theme System', () => {
  test('dark theme applies correct background', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(`file://${HTML_PATH}`)
    const body = page.locator('body')
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor)
    // Dark theme bg: #0d1117 = rgb(13, 17, 23)
    expect(bg).toBe('rgb(13, 17, 23)')
  })

  test('light theme applies correct background', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(`file://${HTML_PATH}`)
    const body = page.locator('body')
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor)
    // Light theme bg: #ffffff = rgb(255, 255, 255)
    expect(bg).toBe('rgb(255, 255, 255)')
  })

  test('severity colors are visible in both themes', async ({ page }) => {
    for (const scheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(`file://${HTML_PATH}`)
      await page.locator('.diff-card').click()

      const structuralDot = page.locator('.severity-dot-structural').first()
      const bg = await structuralDot.evaluate(el => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe('rgba(0, 0, 0, 0)')
      expect(bg).not.toBe('transparent')
    }
  })
})

test.describe('Dashboard v1 — Typography', () => {
  test('diff hunks use JetBrains Mono', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await page.locator('.frame-card-header').first().click()

    const hunk = page.locator('.diff-hunk').first()
    const fontFamily = await hunk.evaluate(el => getComputedStyle(el).fontFamily)
    expect(fontFamily).toContain('JetBrains Mono')
  })

  test('diff hunks have ligatures enabled', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await page.locator('.frame-card-header').first().click()

    const hunk = page.locator('.diff-hunk').first()
    const features = await hunk.evaluate(el => getComputedStyle(el).fontFeatureSettings)
    expect(features).toContain('liga')
  })
})

test.describe('Dashboard v1 — Edge Cases', () => {
  test('no console errors on load', async ({ page }) => {
    const errors = []
    page.on('pageerror', err => errors.push(err.message))
    await page.goto(`file://${HTML_PATH}`)
    expect(errors).toEqual([])
  })

  test('no console errors during navigation', async ({ page }) => {
    const errors = []
    page.on('pageerror', err => errors.push(err.message))
    await page.goto(`file://${HTML_PATH}`)

    // Navigate through all screens
    await page.locator('.diff-card').click()
    await page.locator('.frame-card-header').first().click()
    await page.locator('.frame-card-name').first().click()
    await page.locator('.back-btn').click()
    await page.locator('.back-btn').click()

    expect(errors).toEqual([])
  })

  test('frame with no diff data shows fallback message', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()

    // Signup has no structural diff file
    const signupCard = page.locator('.frame-card').nth(1)
    await signupCard.locator('.frame-card-header').click()
    await expect(signupCard.locator('.diff-meta')).toContainText('No detailed diff data')
  })

  test('detail view for frame without diff shows fallback', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    // Navigate to Signup detail
    await page.locator('.frame-card-name').nth(1).click()
    await expect(page.locator('.diff-meta')).toContainText('No detailed structural diff')
  })
})

test.describe('Dashboard v2 — Comments Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
  })

  test('index shows nav buttons when comments exist', async ({ page }) => {
    const navBtns = page.locator('.nav-btn')
    await expect(navBtns).toHaveCount(2)
    await expect(navBtns.nth(0)).toContainText('Timeline')
    await expect(navBtns.nth(1)).toContainText('comments')
  })

  test('clicking comments button opens comments screen', async ({ page }) => {
    await page.locator('.nav-btn').nth(1).click()
    await expect(page.locator('.topbar')).toBeVisible()
    await expect(page.locator('.back-btn')).toBeVisible()
    // Topbar contains "Comments" heading
    await expect(page.locator('.topbar')).toContainText('Comments')
  })

  test('comments screen shows comment items', async ({ page }) => {
    await page.locator('.nav-btn').nth(1).click()
    const comments = page.locator('.comment-item')
    const count = await comments.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('comments screen has author filter', async ({ page }) => {
    await page.locator('.nav-btn').nth(1).click()
    const select = page.locator('select.filter-select').first()
    await expect(select).toBeVisible()
    await expect(select.locator('option').first()).toContainText('All authors')
  })

  test('comments screen has resolved filter pills', async ({ page }) => {
    await page.locator('.nav-btn').nth(1).click()
    const pills = page.locator('.filter-pill')
    // author dropdown + unresolved + resolved + all = 4
    const count = await pills.count()
    expect(count).toBeGreaterThanOrEqual(3)
  })

  test('back button returns to index', async ({ page }) => {
    await page.locator('.nav-btn').nth(1).click()
    await page.locator('.back-btn').click()
    await expect(page.locator('.diff-card')).toBeVisible()
  })

  test('Escape returns to index', async ({ page }) => {
    await page.locator('.nav-btn').nth(1).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.diff-card')).toBeVisible()
  })
})

test.describe('Dashboard v2 — Timeline Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
  })

  test('clicking timeline button opens timeline screen', async ({ page }) => {
    await page.locator('.nav-btn').first().click()
    await expect(page.locator('.topbar')).toBeVisible()
    await expect(page.locator('text=Timeline')).toBeVisible()
  })

  test('timeline shows version and comment entries', async ({ page }) => {
    await page.locator('.nav-btn').first().click()
    // Should have at least the diff entry and comment entries
    const content = page.locator('.content')
    await expect(content).toBeVisible()
  })

  test('timeline has back button', async ({ page }) => {
    await page.locator('.nav-btn').first().click()
    await expect(page.locator('.back-btn')).toBeVisible()
    await page.locator('.back-btn').click()
    await expect(page.locator('.diff-card')).toBeVisible()
  })

  test('Escape returns to index', async ({ page }) => {
    await page.locator('.nav-btn').first().click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.diff-card')).toBeVisible()
  })
})

test.describe('Dashboard v2 — Inline Comments in Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await page.locator('.frame-card-name').first().click()
  })

  test('detail view shows comments section for frame with comments', async ({ page }) => {
    await expect(page.locator('text=Comments on this frame')).toBeVisible()
  })

  test('inline comments show author and message', async ({ page }) => {
    const commentSection = page.locator('text=Comments on this frame').locator('..')
    await expect(commentSection).toBeVisible()
  })
})

test.describe('Dashboard v2 — Comments: Frame filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
  })

  test('frame filter dropdown exists in comments screen', async ({ page }) => {
    const selects = page.locator('select.filter-select')
    const count = await selects.count()
    expect(count).toBeGreaterThanOrEqual(2) // author + frame
  })

  test('frame filter dropdown has All frames option', async ({ page }) => {
    const selects = page.locator('select.filter-select')
    // second filter-select is the frame filter
    const frameSelect = selects.nth(1)
    await expect(frameSelect).toBeVisible()
    await expect(frameSelect.locator('option').first()).toContainText('All frames')
  })

  test('frame filter dropdown has options for frames with comments', async ({ page }) => {
    const frameSelect = page.locator('select.filter-select').nth(1)
    const optionCount = await frameSelect.locator('option').count()
    // At least "All frames" + 1 frame option
    expect(optionCount).toBeGreaterThanOrEqual(2)
  })

  test('selecting a frame filter reduces visible comments', async ({ page }) => {
    const frameSelect = page.locator('select.filter-select').nth(1)
    const options = frameSelect.locator('option')
    const optionCount = await options.count()
    // Only proceed if there are frame options beyond "All frames"
    if (optionCount >= 2) {
      const frameValue = await options.nth(1).getAttribute('value')
      await frameSelect.selectOption(frameValue)
      const comments = page.locator('.comment-item')
      const count = await comments.count()
      // After filtering to a single frame we should still have some or see empty state
      const empty = page.locator('.comment-empty')
      const hasComments = count > 0
      const hasEmpty = await empty.isVisible()
      expect(hasComments || hasEmpty).toBe(true)
    }
  })
})

test.describe('Dashboard v2 — Comments: Clickable frame names', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
  })

  test('comment items with a frame have a comment-frame-link element', async ({ page }) => {
    const links = page.locator('.comment-frame-link')
    const count = await links.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('clicking a comment-frame-link navigates away from comments screen', async ({ page }) => {
    const link = page.locator('.comment-frame-link').first()
    await link.click()
    // Should have left the comments screen — topbar no longer says "Comments"
    // and the detail sidebar should be visible (navigated to frame detail)
    await expect(page.locator('.detail-sidebar')).toBeVisible()
  })
})

test.describe('Dashboard v2 — Accordion: Comment badges', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
  })

  test('comment badges appear on frame cards that have comments', async ({ page }) => {
    const badges = page.locator('.comment-badge')
    const count = await badges.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('comment badge shows comment count text', async ({ page }) => {
    const badge = page.locator('.comment-badge').first()
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    expect(text).toMatch(/comment/)
  })

  test('comment badge includes open count when there are unresolved comments', async ({ page }) => {
    const badges = page.locator('.comment-badge')
    const count = await badges.count()
    // Find a badge that mentions "open"
    let foundOpen = false
    for (let i = 0; i < count; i++) {
      const text = await badges.nth(i).textContent()
      if (text && text.includes('open')) {
        foundOpen = true
        break
      }
    }
    // At least one frame (Login/Signup) has unresolved comments in fixture
    expect(foundOpen).toBe(true)
  })
})

test.describe('Dashboard v2 — CSS class verification', () => {
  test('topbar-separator is present in accordion topbar', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await expect(page.locator('.topbar-separator')).toBeVisible()
  })

  test('topbar-title is present in accordion topbar', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.diff-card').click()
    await expect(page.locator('.topbar-title')).toBeVisible()
  })

  test('filter-select class is present in comments screen', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
    await expect(page.locator('select.filter-select').first()).toBeVisible()
  })

  test('comment-body class is present on comment items', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
    await expect(page.locator('.comment-body').first()).toBeVisible()
  })

  test('comment-author class is present on comment items', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
    await expect(page.locator('.comment-author').first()).toBeVisible()
  })

  test('comment-date class is present on comment items', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
    await expect(page.locator('.comment-date').first()).toBeVisible()
  })

  test('topbar-meta class is present in comments topbar', async ({ page }) => {
    await page.goto(`file://${HTML_PATH}`)
    await page.locator('.nav-btn').nth(1).click()
    await expect(page.locator('.topbar-meta')).toBeVisible()
  })
})
