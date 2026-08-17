// Генератор дашборда «Купленные лоты — Hyper Invest» v2.
// Источники: offerings (сколько куплено/всего) + equipments_list (адреса станций).
// История по дням копится внутри самой страницы: читаем прошлую из history.json
// (её кладёт задача, вытащив из текущего артефакта), дописываем сегодняшний срез,
// перезашиваем обратно в HTML.
import { readFileSync, writeFileSync } from "node:fs";

const B = "https://api.zorko-exchange.ru/v1";
const j = async (u) => {
  const r = await fetch(u, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("API " + r.status + " " + u);
  return r.json();
};

const offerings = (await j(`${B}/lending/public/offerings`))
  .filter((o) => (o.companyTitle || "").trim() === "Hyper Invest");
const equipment = (await j(`${B}/hyper-adapter/invest/equipments_list`)).content || [];
const byInv = {};
for (const e of equipment) byInv[e.equipmentInventoryNumber] = e;

const st = offerings.map((o) => {
  const total = o.totalLots || 0, avail = o.availableLots || 0;
  const e = byInv[o.title] || {};
  return {
    addr: (e.locationName || e.locationAddress || o.title || "").trim(),
    city: (e.locationCity || "").trim(),
    total, bought: Math.max(0, total - avail),
  };
}).sort((a, b) => b.bought - a.bought || a.addr.localeCompare(b.addr, "ru"));

const sum = (k) => st.reduce((a, s) => a + s[k], 0);
const purchased = sum("bought"), totalLots = sum("total"), available = totalLots - purchased;

// ---- история по дням (кумулятивный total на конец дня) ----
const TZ = "Europe/Moscow";
const dkey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TRACK_START = "2026-08-12"; // точка отсчёта отслеживания
// Известный факт: до 13.08 куплено 0, все первые лоты куплены 13.08.
const SEED = { "2026-08-12": 0, "2026-08-13": 5 };
let history = {};
try { history = JSON.parse(readFileSync("history.json", "utf8")) || {}; } catch {}
if (typeof history !== "object" || Array.isArray(history)) history = {};
const today = dkey(new Date());
if (Object.keys(history).length === 0) history = { ...SEED }; // восстановление базы при пустой истории
history[today] = purchased; // последний известный кумулятивный total за сегодня

// дневные приращения: total(day) - total(предыдущего записанного дня); первый день = 0 (базовая точка)
const dates = Object.keys(history).sort();
const dailyNew = {};
let prev = null;
for (const d of dates) {
  dailyNew[d] = prev === null ? 0 : Math.max(0, history[d] - prev);
  prev = history[d];
}
const trackedSince = dates[0] || today;
const boughtTracked = Object.values(dailyNew).reduce((a, b) => a + b, 0);

// сводка: за 7 дней (включая сегодня) и за текущий месяц
const weekAgo = dkey(new Date(Date.now() - 6 * 864e5));
const ym = today.slice(0, 7);
let weekSum = 0, monthSum = 0;
for (const d of Object.keys(dailyNew)) {
  if (d >= weekAgo && d <= today) weekSum += dailyNew[d];
  if (d.startsWith(ym)) monthSum += dailyNew[d];
}

// ---- вёрстка календаря текущего месяца ----
const now = new Date();
const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).format(now).split("-");
const Y = +parts[0], M = +parts[1]; // M: 1..12
const monthName = new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, month: "long", year: "numeric" }).format(now);
const daysInMonth = new Date(Y, M, 0).getDate();
let firstDow = new Date(Y, M - 1, 1).getDay(); // 0=вс
firstDow = (firstDow + 6) % 7; // 0=пн
const maxDaily = Math.max(1, ...Object.values(dailyNew));
const cells = [];
for (let i = 0; i < firstDow; i++) cells.push('<div class="cal-cell empty"></div>');
for (let day = 1; day <= daysInMonth; day++) {
  const ds = `${Y}-${String(M).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const n = dailyNew[ds] || 0;
  const tracked = ds in history;
  const lvl = n === 0 ? 0 : n >= maxDaily ? 4 : n >= Math.ceil(maxDaily * 0.66) ? 3 : n >= Math.ceil(maxDaily * 0.33) ? 2 : 1;
  const cls = `cal-cell l${lvl}${tracked ? "" : " untracked"}${ds === today ? " today" : ""}`;
  const title = tracked ? `${ds}: +${n} лот(ов)` : `${ds}: нет данных`;
  cells.push(`<div class="${cls}" title="${title}"><span class="d">${day}</span>${n > 0 ? `<span class="v">+${n}</span>` : ""}</div>`);
}
const calGrid = cells.join("");

const nf = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const stamp = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(now).replace(",", "");
const sinceHuman = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", timeZone: TZ }).format(new Date(trackedSince + "T12:00:00+03:00"));

const rows = st.map((s) => {
  const w = s.total ? (100 * s.bought / s.total).toFixed(1) : 0;
  return `<tr class="${s.bought > 0 ? "" : "zero"}"><td class="addr"><span class="a1">${s.addr}</span>${s.city && s.city !== s.addr ? `<span class="a2">${s.city}</span>` : ""}</td>` +
    `<td class="num bought">${s.bought}</td><td class="num">${s.total}</td>` +
    `<td><div class="bar"><span style="width:${w}%"></span></div></td></tr>`;
}).join("\n        ");

const html = `<title>Купленные лоты — Hyper Invest</title>
<style>
  :root{--bg:#f6f8f7;--panel:#fff;--line:#e3e8e6;--ink:#141a18;--muted:#5f6b66;--faint:#8a948f;--accent:#0f9d63;--accent-soft:#e2f3ea;--accent-ink:#0b7a4d;--track:#eceeed;--shadow:0 1px 2px rgba(20,26,24,.05),0 8px 24px rgba(20,26,24,.05);--mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--l1:#bfe6d0;--l2:#7fce9f;--l3:#33ab6d;--l4:#0f8a50}
  @media (prefers-color-scheme:dark){:root{--bg:#0c110f;--panel:#141b18;--line:#232c28;--ink:#e8efeb;--muted:#9aa8a2;--faint:#6b776f;--accent:#3ddc84;--accent-soft:#12271d;--accent-ink:#5fe89b;--track:#1e2723;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);--l1:#173d29;--l2:#1f6b43;--l3:#2fa564;--l4:#3ddc84}}
  :root[data-theme="light"]{--bg:#f6f8f7;--panel:#fff;--line:#e3e8e6;--ink:#141a18;--muted:#5f6b66;--faint:#8a948f;--accent:#0f9d63;--accent-soft:#e2f3ea;--accent-ink:#0b7a4d;--track:#eceeed;--shadow:0 1px 2px rgba(20,26,24,.05),0 8px 24px rgba(20,26,24,.05);--l1:#bfe6d0;--l2:#7fce9f;--l3:#33ab6d;--l4:#0f8a50}
  :root[data-theme="dark"]{--bg:#0c110f;--panel:#141b18;--line:#232c28;--ink:#e8efeb;--muted:#9aa8a2;--faint:#6b776f;--accent:#3ddc84;--accent-soft:#12271d;--accent-ink:#5fe89b;--track:#1e2723;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);--l1:#173d29;--l2:#1f6b43;--l3:#2fa564;--l4:#3ddc84}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;padding:32px 20px 64px}
  .wrap{max-width:760px;margin:0 auto}
  .eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-ink);font-weight:700;margin:0 0 6px;display:flex;align-items:center;gap:8px}
  .eyebrow .bolt{width:14px;height:14px;flex:none}
  h1{font-size:23px;font-weight:650;letter-spacing:-.02em;margin:0 0 4px;text-wrap:balance}
  h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:650;margin:26px 4px 12px}
  .src{color:var(--faint);font-size:13px;margin:0}
  .src a{color:var(--accent-ink);text-decoration:none;border-bottom:1px solid transparent}
  .src a:hover{border-bottom-color:currentColor}
  .live{display:inline-flex;align-items:center;gap:5px}
  .live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 55%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
  @media (prefers-reduced-motion:reduce){.live::before{animation:none}}
  .hero{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:22px 24px;margin:22px 0 14px;display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
  .hero .big{font-family:var(--mono);font-size:52px;font-weight:600;line-height:1;color:var(--accent);letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .hero .cap{font-size:15px;color:var(--muted)}
  .hero .cap b{color:var(--ink);font-variant-numeric:tabular-nums}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:6px}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .kpi .n{font-family:var(--mono);font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
  .kpi .l{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-top:2px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .cal-sum{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
  .cal-sum .sum{flex:1 1 90px;background:var(--accent-soft);border-radius:10px;padding:9px 12px;display:flex;flex-direction:column;gap:1px}
  .cal-sum .sn{font-family:var(--mono);font-size:20px;font-weight:700;color:var(--accent-ink);font-variant-numeric:tabular-nums;line-height:1.1}
  .cal-sum .sl{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--accent-ink);opacity:.75}
  .cal-caption{font-size:12.5px;color:var(--faint);margin:0 2px 12px}
  .cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px}
  .cal-dow span{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);text-align:center}
  .cal{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
  .cal-cell{position:relative;aspect-ratio:1/1;border-radius:8px;background:var(--track);display:flex;flex-direction:column;justify-content:space-between;padding:5px 6px;min-height:38px}
  .cal-cell.empty{background:transparent}
  .cal-cell.untracked{background:repeating-linear-gradient(45deg,var(--track),var(--track) 4px,transparent 4px,transparent 8px);opacity:.5}
  .cal-cell.l1{background:var(--l1)}.cal-cell.l2{background:var(--l2)}.cal-cell.l3{background:var(--l3)}.cal-cell.l4{background:var(--l4)}
  .cal-cell.today{outline:2px solid var(--accent);outline-offset:1px}
  .cal-cell .d{font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums}
  .cal-cell.l2 .d,.cal-cell.l3 .d,.cal-cell.l4 .d{color:rgba(255,255,255,.85)}
  .cal-cell .v{font-family:var(--mono);font-size:13px;font-weight:700;align-self:flex-end}
  .cal-cell.l1 .v{color:var(--accent-ink)}.cal-cell.l2 .v,.cal-cell.l3 .v,.cal-cell.l4 .v{color:#fff}
  .legend{display:flex;align-items:center;gap:6px;margin-top:12px;font-size:11px;color:var(--faint)}
  .legend i{width:13px;height:13px;border-radius:4px;display:inline-block}
  .tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
  table{border-collapse:collapse;width:100%;min-width:460px;font-size:14px}
  thead th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);font-weight:600;text-align:left;padding:11px 16px;border-bottom:1px solid var(--line)}
  th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono)}
  tbody td{padding:10px 16px;border-bottom:1px solid var(--line);vertical-align:middle}
  tbody tr:last-child td{border-bottom:none}
  .addr .a1{display:block}
  .addr .a2{display:block;font-size:12px;color:var(--faint)}
  .bought{font-weight:700}
  tr.zero .bought{color:var(--faint);font-weight:500}
  tr:not(.zero) .bought{color:var(--accent-ink)}
  .bar{position:relative;height:6px;width:110px;background:var(--track);border-radius:99px;overflow:hidden}
  .bar>span{position:absolute;inset:0 auto 0 0;background:var(--accent);border-radius:99px}
  .foot{margin:22px 4px 0;color:var(--faint);font-size:12.5px;line-height:1.6}
  .foot code{font-family:var(--mono);font-size:12px;background:var(--track);padding:1px 5px;border-radius:5px;color:var(--muted)}
  @media (max-width:560px){.hero .big{font-size:44px}.bar{width:76px}.cal-cell{min-height:34px}}
</style>
<div class="wrap">
  <p class="eyebrow"><svg class="bolt" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></svg>Hyper Invest · зарядные станции</p>
  <h1>Купленные лоты по всем станциям</h1>
  <p class="src"><span class="live">Обновляется автоматически</span> · данные от ${stamp} МСК · <a href="https://zorko-exchange.ru/catalog/hyper-invest" target="_blank" rel="noopener">источник</a></p>
  <div class="hero">
    <div class="big">${purchased}</div>
    <div class="cap">лотов куплено из&nbsp;<b>${nf(totalLots)}</b> по&nbsp;<b>${st.length}</b>&nbsp;станциям<br>доступно ещё <b>${nf(available)}</b></div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="n">${nf(purchased)}</div><div class="l">Куплено всего</div></div>
    <div class="kpi"><div class="n">${nf(available)}</div><div class="l">Доступно</div></div>
    <div class="kpi"><div class="n">${st.length}</div><div class="l">Станций</div></div>
  </div>

  <h2>Куплено лотов по дням · ${monthName}</h2>
  <div class="card">
    <div class="cal-sum">
      <div class="sum"><span class="sn">+${weekSum}</span><span class="sl">за 7 дней</span></div>
      <div class="sum"><span class="sn">+${monthSum}</span><span class="sl">за месяц</span></div>
      <div class="sum"><span class="sn">+${boughtTracked}</span><span class="sl">с ${sinceHuman}</span></div>
    </div>
    <p class="cal-caption">Новые покупки за день. Точка отсчёта — ${sinceHuman}; её значение принято за базу, новые лоты считаются от неё. Дни до старта отслеживания заштрихованы.</p>
    <div class="cal-dow"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
    <div class="cal">${calGrid}</div>
    <div class="legend"><span>меньше</span><i style="background:var(--track)"></i><i style="background:var(--l1)"></i><i style="background:var(--l2)"></i><i style="background:var(--l3)"></i><i style="background:var(--l4)"></i><span>больше</span></div>
  </div>

  <h2>Разбивка по станциям</h2>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Станция</th><th class="num">Куплено</th><th class="num">Всего</th><th>Заполнение</th></tr></thead>
    <tbody>
        ${rows}
    </tbody>
  </table></div>
  <p class="foot">«Куплено» = <code>totalLots − availableLots</code> по каждому размещению (совпадает с полем <code>settledLots</code>). Публичные данные по всей площадке. Календарь копит статистику с момента запуска отслеживания.</p>
</div>
<div hidden aria-hidden="true">HIST:${JSON.stringify(history)}:HIST</div>`;

writeFileSync("index.html", html);
writeFileSync("history.json", JSON.stringify(history));
console.log(`OK: куплено ${purchased} из ${totalLots} по ${st.length} станциям; дней в истории: ${dates.length}; ${html.length} байт`);
