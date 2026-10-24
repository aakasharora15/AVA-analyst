import { html } from '../lib/html.js';

import { TEAM as MEMBERS } from '../content/business.js';

export default {
  title: 'Team · AVA',

  render() {
    return html`
<section class="t-intro" aria-labelledby="team-title">
  <span class="lbl lbl-accent">Founding team</span>
  <h1 id="team-title" class="display-l">The people behind AVA</h1>
  <p class="t-intro-sub">Four founding members, building a risk platform that tells you the truth before the capital goes in.</p>
  <a class="btn btn-primary btn-lg" href="/free-audit">Try a free audit</a>
</section>

<ul class="t-grid" aria-label="Founding members">
  ${MEMBERS.map((m) => html`<li class="card t-member">
    <span class="t-avatar" aria-hidden="true" style="background:${m.gradient}">${m.name[0]}</span>
    <div><h2 class="t-name">${m.name}</h2><div class="lbl t-role">${m.role}</div></div>
    ${m.bio ? html`<p class="t-bio">${m.bio}</p>` : ''}
  </li>`)}
</ul>`;
  },
};
