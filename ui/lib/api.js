import S from './state.js';
import { escHtml } from './helpers.js';

async function api(service, path, method='GET', body=null) {
  const payload={api_key:S.apiKey, service, path, method, body};
  if(S.apiBase) payload.base_url=S.apiBase;
  const r = await fetch('/api', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
  const text = await r.text();
  if(!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const e=JSON.parse(text); msg=e?.message||e?.error||e?.detail||msg; } catch{}
    throw new Error(msg);
  }
  if(!text.trim()) return null;
  try { return JSON.parse(text); }
  catch {
    const lines=text.trim().split('\n').filter(l=>l.trim());
    try { return lines.map(l=>JSON.parse(l)); } catch { return null; }
  }
}

function toast(type, title, msg) {
  const icons={success:'fa-circle-check',error:'fa-circle-xmark',info:'fa-circle-info'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<div class="toast-icon"><i class="fa-solid ${icons[type]||icons.info}"></i></div><div class="toast-msg"><strong>${escHtml(title)}</strong>${msg?escHtml(msg):''}</div>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>{ el.classList.add('fade-out'); el.addEventListener('animationend',()=>el.remove()); },4500);
}

export { api, toast };
