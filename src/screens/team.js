import { html } from '../lib/html.js';

// Roles and bios are supplied later; the placeholder stays until then.
const MEMBERS = [
  { name: 'Alevtyna', gradient: 'linear-gradient(145deg,#8B7DFF,#5CC8FF)' },
  { name: 'Amar', gradient: 'linear-gradient(145deg,#B07DFF,#FF8FB8)' },
  { name: 'Anastasiia', gradient: 'linear-gradient(145deg,#5C7DFF,#7DF0E0)' },
  { name: 'Aakash', gradient: 'linear-gradient(145deg,#7B6CFF,#FFA566)' },
];

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
    <div><h2 class="t-name">${m.name}</h2><div class="lbl t-role">Founding member</div></div>
    <p class="t-bio">[ROLE AND ONE-LINE BIO TO BE SUPPLIED]</p>
  </li>`)}
</ul>`;
  },
};
