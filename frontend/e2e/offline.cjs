// Core STOPPED: the UI must show honest connection errors and no invented results.
const { chromium } = require('playwright')
const S = process.env.E2E_OUT || '.e2e-out', BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173'
require('fs').mkdirSync(S + '/shots', { recursive: true })
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 } })).newPage()
  const out = []; const ok = (n, c, x = '') => { out.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')) }
  await p.goto(BASE + '/'); await p.waitForTimeout(2500)
  const body = () => p.textContent('body')
  ok('обзор: баннер «ядро недоступно»', /Вычислительное ядро недоступно/.test(await body()) && /Нет связи с ядром GeoMoon/.test(await body()))
  ok('обзор: нет выдуманной статистики', /—/.test(await p.textContent('[data-testid="counts"]')))
  await p.click('[data-testid="nav-terrain"]'); await p.fill('[data-testid="f-radius_m"]', '1000'); await p.click('[data-testid="run-analysis"]')
  await p.waitForSelector('[role="alert"]', { timeout: 15000 })
  ok('анализ: ошибка соединения показана', /Нет связи/.test(await p.textContent('[role="alert"]')))
  ok('анализ: результаты не выдуманы', (await p.locator('[data-testid="summary"]').count()) === 0)
  await p.click('[data-testid="nav-data"]'); await p.waitForSelector('[role="alert"]', { timeout: 15000 }); ok('источники: ошибка показана', true)
  await p.click('[data-testid="nav-spacecraft"]'); await p.waitForSelector('[role="alert"]', { timeout: 15000 }); ok('аппараты: ошибка показана, каталог пуст', (await p.locator('[data-testid="vehicle-list"] li').count()) === 0)
  await p.click('[data-testid="nav-simulation"]'); await p.waitForTimeout(1500); await p.click('[data-testid="start"]'); await p.waitForTimeout(800)
  ok('симуляция: без ядра нет результата', (await p.locator('[data-testid="result-summary"]').count()) === 0 && /Выберите аппарат|Нет связи/.test(await body()))
  await p.screenshot({ path: `${S}/shots/offline.png` })
  await b.close(); process.exit(out.every(Boolean) ? 0 : 1)
})()
