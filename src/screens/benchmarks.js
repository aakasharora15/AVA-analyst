import { html } from '../lib/html.js';
import { getCompanies, SAMPLE } from '../data/repo.js';
import { CATEGORIES } from '../engine/config.js';
import { TYPE_LABEL, vClass, emptyState } from '../components/ui.js';
import { companyPicker, mountCompanyPicker } from '../components/company-picker.js';

const median = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export default {
  title: 'Benchmarks · AVA',
  className: 'benchmarks',

  async load(ctx) {
    const companies = await getCompanies();
    return { companies, companyId: ctx.query.get('company') || SAMPLE.companyId };
  },

  render(ctx, { companies, companyId }) {
    const cur = companies.find((c) => c.id === companyId);
    const peers = companies.filter((c) => c.type === cur.type && c.latest);
    const head = html`<div class="page-head">
  <div class="page-head-copy"><span class="lbl">Sample data · ${TYPE_LABEL[cur.type]}s only</span><h1 class="page-title">Benchmarks</h1><p class="muted page-sub">Where a company sits against the rest of your portfolio, by score and by risk category. Only ventures of the same type are compared, because scores are not comparable across types.</p></div>
  ${companyPicker(companies, companyId)}
</div>`;
    if (peers.length < 3 || !cur.latest) {
      return html`${head}${emptyState({
        title: 'Not enough to compare yet.',
        body: `Benchmarks need at least three scored ${TYPE_LABEL[cur.type].toLowerCase()}s. You have ${peers.length}. ${cur.title} is a ${TYPE_LABEL[cur.type].toLowerCase()}, so it is only compared with other ${TYPE_LABEL[cur.type].toLowerCase()}s.`,
        action: { href: '/new-analysis', label: `Audit another ${TYPE_LABEL[cur.type].toLowerCase()}` },
        secondary: { href: '/benchmarks?company=northline', label: 'See startup benchmarks' },
      })}`;
    }
    const ranked = peers.slice().sort((a, b) => b.latest.score - a.latest.score);
    const rank = ranked.findIndex((c) => c.id === cur.id) + 1;
    const med = median(peers.map((c) => c.latest.score));
    const cats = CATEGORIES.map((c) => {
      const v = cur.latest.exposure[c];
      const m = median(peers.map((p) => p.latest.exposure[c]));
      return { c, v, m, d: v - m };
    });
    const worst = cats.slice().sort((a, b) => b.d - a.d)[0];
    const dots = peers.slice().sort((a, b) => a.latest.score - b.latest.score);
    return html`${head}
<div class="split">
  <aside class="side">
    <div class="card bm-pick">
      <span class="lbl bm-pick-l">${TYPE_LABEL[cur.type]}s by score</span>
      ${ranked.map((c) => html`<a class="list-btn" href="/benchmarks?company=${c.id}"${c.id === cur.id ? html` aria-current="true"` : ''}><span>${c.title}</span><span class="mono">${c.latest.score}</span></a>`)}
    </div>
    <div class="card card-pad stack-sm"><span class="lbl">Reading</span><p class="small">${cur.title} ranks ${rank} of ${peers.length} ${TYPE_LABEL[cur.type].toLowerCase()}s by score. ${worst.d > 0 ? `Its weakest category against peers is ${worst.c.toLowerCase()}, at ${worst.v} against a median of ${worst.m}.` : 'It is at or better than the median in every category.'}</p></div>
  </aside>
  <section class="body">
    <div class="hero-panel bm-hero">
      <div class="stars" aria-hidden="true"></div>
      <div class="bm-nums">
        <div><span class="lbl">${cur.title} · rank by score</span><span class="hero-num">${rank}<span class="r-of"> of ${peers.length}</span></span></div>
        <div class="row-actions bm-mini"><div><div class="lbl">Score</div><div class="hero-dir">${cur.latest.score}</div></div><div><div class="lbl">Median</div><div class="hero-dir">${med}</div></div></div>
      </div>
      <div class="bm-axis" role="img" aria-label="Scores of ${peers.length} ${TYPE_LABEL[cur.type].toLowerCase()}s on a 0 to 100 axis: ${dots.map((c) => `${c.title} ${c.latest.score}`).join(', ')}">
        <span class="bm-line"></span>
        ${dots.map((c, i) => html`<span class="bm-dot ${vClass(c.latest.finalDirective)}${c.id === cur.id ? ' on' : ''}" style="left:${c.latest.score}%;--row:${i % 2}"><span class="bm-dot-l">${c.id === cur.id ? `${c.title.split(' ')[0]} ${c.latest.score}` : c.latest.score}</span></span>`)}
        <span class="lbl bm-min">0 · most risk</span><span class="lbl bm-max">100 · least risk</span>
      </div>
    </div>
    <div class="card card-pad stack-sm">
      <div class="r-sec-head"><span class="lbl">Exposure by category · higher is worse</span><span class="xsmall muted"><span class="key key-b"></span> ${cur.title} <span class="key key-med"></span> median</span></div>
      ${cats.map((x) => html`<div class="bm-cat"><span class="small">${x.c}</span><span class="bar bm-bar" role="img" aria-label="${x.c}: ${x.v} against median ${x.m}"><span style="width:${x.v}%"></span><i style="left:${x.m}%"></i></span><span class="small strong ${x.d > 0 ? 'delta-down' : x.d < 0 ? 'delta-up' : 'delta-flat'}">${x.v} vs ${x.m} · ${x.d > 0 ? 'worse' : x.d < 0 ? 'better' : 'level'}</span></div>`)}
    </div>
  </section>
</div>`;
  },

  mount(root, ctx) {
    const ac = new AbortController();
    mountCompanyPicker(root, ctx, '/benchmarks', ac.signal);
    return () => ac.abort();
  },
};
