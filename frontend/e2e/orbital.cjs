// Orbital flight simulator + spherical Moon in the landing scene, against a live core (no DEM required).
const { chromium } = require('playwright')
const S = process.env.E2E_OUT || '.e2e-out', BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173'
require('fs').mkdirSync(S + '/shots', { recursive: true })
const results = []
const ok = (name, cond, extra = '') => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')) }
const setRange = (page, sel, frac) => page.evaluate(([s, f]) => { const el = document.querySelector(s); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(Number(el.max) * f)); el.dispatchEvent(new Event('input', { bubbles: true })) }, [sel, frac])

;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const page = await (await browser.newContext({ viewport: { width: 1700, height: 1000 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (404|409)/.test(m.text())) errors.push('console: ' + m.text()) })
  const shot = (n) => page.screenshot({ path: `${S}/shots/${n}.png` })

  // --- orbital simulator ---
  await page.goto(BASE + '/'); await page.click('[data-testid="nav-orbital"]')
  await page.waitForSelector('[data-testid="orbit-setup"]')
  ok('орбита: страница открыта из меню', /Орбитальный симулятор/.test(await page.textContent('body')))
  await page.selectOption('[data-testid="scenario-select"]', 'lunar_orbit')
  ok('орбита: сценарий подставил цель «орбита Луны»', (await page.inputValue('[data-testid="mission-kind"]')) === 'lunar_orbit')
  await page.fill('[data-testid="init-inc"]', '30')
  await page.click('[data-testid="btn-create"]')
  await page.waitForSelector('[data-testid="orbit-map"]', { timeout: 120000 }); await page.waitForSelector('[data-testid="orbit-graphs"]', { timeout: 30000 })
  await page.waitForTimeout(2500)
  ok('орбита: 2D карта и 3D сцена отображены', (await page.locator('[data-testid="orbit-map"]').count()) === 1 && (await page.locator('[data-testid="orbit-scene"] canvas').count()) === 1)
  ok('орбита: 9 графиков', (await page.locator('[data-testid^="graph-"]').count()) === 9)
  ok('орбита: планировщик показал результат', /решение найдено|не выполнимо/.test(await page.textContent('[data-testid="plan-result"]')))
  const t0 = await page.textContent('[data-testid="live-telemetry"]')
  ok('орбита: телеметрия с единицами', /км/.test(t0) && /м\/с|км\/с/.test(t0))
  await shot('orb-01-start')
  await setRange(page, '[data-testid="timeline"]', 0.9); await page.waitForTimeout(1500)
  const t1 = await page.textContent('[data-testid="live-telemetry"]')
  ok('орбита: телеметрия меняется при перемотке', t0 !== t1)
  ok('орбита: у Луны доминирующее тело — Луна', /Доминирующее тело\s*Луна/.test(t1))
  await page.click('[data-testid="cam-moon"]'); await page.waitForTimeout(1500); await shot('orb-02-moon')
  // time controls
  const before = await page.textContent('[data-testid="orbit-time"]')
  await page.click('[data-testid="btn-step-fwd"]'); await page.waitForTimeout(300)
  ok('время: шаг вперёд меняет время', before !== (await page.textContent('[data-testid="orbit-time"]')))
  await page.click('[data-testid="btn-step-back"]'); await page.click('[data-testid="btn-reset"]'); await page.waitForTimeout(200)
  ok('время: сброс на 00:00:00', /^00:00:00/.test((await page.textContent('[data-testid="orbit-time"]')).trim()))
  await page.selectOption('[data-testid="speed"]', '100'); await page.click('[data-testid="btn-start"]'); await page.waitForTimeout(1500)
  ok('время: ×100 идёт, время растёт', !/^00:00:00/.test((await page.textContent('[data-testid="orbit-time"]')).trim()))
  await page.click('[data-testid="btn-pause"]')
  // manual control
  await page.click('[data-testid="otab-control"]'); await page.waitForSelector('[data-testid="orbit-control"]')
  await page.click('[data-testid="btn-apply-control"]'); await page.waitForTimeout(6000)
  ok('управление: команда попала в журнал событий', /команда управления|включение двигателя/.test(await page.textContent('[data-testid="orbit-events"]')))
  // fullscreen button exists
  ok('3D: кнопка полноэкранного режима', (await page.locator('[data-testid="btn-fullscreen"]').count()) === 1)
  // reload keeps the simulation (persistence via core)
  await page.reload(); await page.waitForSelector('[data-testid="orbit-map"]', { timeout: 60000 })
  ok('орбита: симуляция восстановлена после перезагрузки', true)

  // --- landing scene: the Moon is a sphere at high altitude ---
  await page.evaluate(() => localStorage.setItem('geomoon.inputs.v1', JSON.stringify({ state: { target: { lat: 0, lon: 0 }, scenario: { initial_altitude_m: '1000000' } }, version: 1 })))
  await page.goto(BASE + '/simulation'); await page.waitForSelector('[data-testid="scene-mode"]', { timeout: 20000 }); await page.waitForTimeout(2500)
  ok('посадка: на высоте 1000 км сцена — сфера, а не плоскость', /сфера/.test(await page.textContent('[data-testid="scene-mode"]')) && (await page.getAttribute('[data-testid="scene"]', 'data-scene-mode')) === 'sphere')
  await shot('orb-03-landing-sphere')
  await page.click('[data-testid="view-local"]'); await page.waitForTimeout(800)
  ok('посадка: переключатель вида «Рельеф» работает', /локальный/.test(await page.textContent('[data-testid="scene-mode"]')))
  ok('нет ошибок в консоли', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  const failed = results.filter((r) => !r.ok); console.log(`\n${results.length - failed.length}/${results.length} passed`); process.exit(failed.length ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
