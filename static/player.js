let current = {};
let rafId = null;

function mmss(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s/60), sec = s % 60;
  return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}

function render() {
  document.documentElement.style.setProperty('--dim', current.bg_dim ?? 0.35);
  document.getElementById('bg').style.backgroundImage = current.bg_url ? `url("${current.bg_url}")` : 'none';

  // Resource bar (ordered)
  const resbar = document.getElementById('resbar');
  const res = current.resources || {};
  const order = current.resource_order || Object.keys(res);
  const parts = [];
  order.forEach(name=>{
    if (name in res) parts.push(name.charAt(0).toUpperCase() + name.slice(1) + ': ' + res[name]);
  });
  resbar.textContent = parts.join('  •  ');

  // Scene
  document.getElementById('title').textContent = current.title || '';
  document.getElementById('desc').textContent  = current.description || '';

  // Choices
  const box = document.getElementById('choices');
  box.innerHTML = '';
  (current.choices||[]).forEach(c=>{
    const el = document.createElement('div');
    el.className = 'choice';
    el.innerHTML = `
      <div class="label">${(c.label||'')}</div>
      <div class="effects">${(c.effects_text||'')}</div>`;
    box.appendChild(el);
  });

  // Result banner
  const result = document.getElementById('result');
  const txt = (current.last_result_text||'').trim();
  result.style.display = txt ? 'block' : 'none';
  result.textContent = txt;

  // Widgets
  document.getElementById('blackout').style.display = current.blackout ? 'block' : 'none';
  document.getElementById('timer').style.display    = current.show_timer ? 'block' : 'none';
}

function renderTimerLoop() {
  if (!current.show_timer) return;
  const el = document.getElementById('timer');
  const endsAt = current.timer_ends_at;
  if (endsAt) {
    const remain = Math.max(0, Math.round(endsAt - (Date.now()/1000)));
    el.textContent = mmss(remain);
    if (remain <= 0) { current.timer_ends_at = null; }
  } else {
    el.textContent = mmss(current.timer_seconds || 0);
  }
  rafId = requestAnimationFrame(renderTimerLoop);
}

function applyState(s) {
  current = s;
  render();
  if (rafId) cancelAnimationFrame(rafId);
  if (current.show_timer) rafId = requestAnimationFrame(renderTimerLoop);
}

const es = new EventSource('/stream');
es.onmessage = (ev) => {
  try { applyState(JSON.parse(ev.data)); } catch {}
};
