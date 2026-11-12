/* Página inicial do Black Hole Clube.
   Funciona sem nada configurado (mostra a ficha salva no navegador).
   Com o link da Artemis (/mesa), mostra também a campanha, quem está na mesa e a atividade. */
import { abrirSessao, firebaseConfigurado, servidorSalvo, esquecerMesa } from './bhc-firebase.js';

const $ = (id) => document.getElementById(id);
const ler = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

const CORES = ['#F3E6D4', '#D9DEEB', '#A24BD6', '#6AA8FF', '#E8A25A', '#7FD6A8', '#ff9fb0'];
const corDe = (txt) => { let h = 0; for (const c of String(txt)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; };
const sigla = (nome) => String(nome || '?').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';

function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function quando(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/* ---------- menu ---------- */
function ligarMenu() {
  const g = $('gaveta'), f = $('gavetaFundo');
  const abrir = (v) => { g.hidden = !v; f.hidden = !v; };
  $('btnMenu').addEventListener('click', () => abrir(g.hidden));
  f.addEventListener('click', () => abrir(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrir(false); });
}

/* ---------- minha ficha (salva pelo ficha.html) ---------- */
function mostrarFicha() {
  const r = ler('bhcResumo_v1');
  if (!r) return;
  $('fichaNome').textContent = r.nome || 'Personagem sem nome';
  $('fichaEstado').textContent = [r.saude, r.sanidadeEstado].filter(Boolean).join(' · ');
  const barra = (id, tId, b) => {
    if (!b) return;
    const max = Math.max(1, b.max || 0);
    $(id).style.width = Math.max(0, Math.min(100, Math.round(((b.cur || 0) / max) * 100))) + '%';
    $(tId).textContent = `${b.cur || 0}/${b.max || 0}`;
  };
  barra('bVida', 'tVida', r.vida);
  barra('bSani', 'tSani', r.sanidade);
  barra('bForca', 'tForca', r.forca);
  if (r.retrato) {
    const f = $('fichaFoto');
    f.innerHTML = '';
    const img = new Image(); img.alt = ''; img.src = r.retrato; f.appendChild(img);
  }
  if (r.nome) $('ola').textContent = 'Olá, ' + r.nome.split(' ')[0];
}

function mostrarLivro() {
  const url = (window.SITE_CONFIG || {}).livroDeRegras;
  if (!url) return;
  const a = $('atLivro');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.removeAttribute('aria-disabled');
  $('livroTxt').textContent = 'Consulta rápida do sistema';
}

function status(tipo, txt) {
  const s = $('status');
  s.className = 'bhc-status' + (tipo ? ' ' + tipo : '');
  $('statusTxt').textContent = txt;
}

/* ---------- ligado ao Firebase ---------- */
async function ligarOnline() {
  const sessao = await abrirSessao();
  if (!sessao) {
    if (servidorSalvo() && firebaseConfigurado()) status('', 'Modo local');
    return;
  }
  if (sessao.erro) { status('erro', sessao.erro); return; }

  const { fb, db, s, uid } = sessao;
  const meu = ler('bhcResumo_v1') || {};
  const nome = sessao.nome || meu.nome || '';
  $('eu').hidden = false;
  $('euNome').textContent = nome || 'Você';
  $('euAv').textContent = sigla(nome || 'Eu');
  $('euPapel').textContent = sessao.mestre ? 'Mestre' : sessao.mesa ? 'Jogador' : 'Conectado';
  $('btnSair').hidden = false;
  $('btnSair').addEventListener('click', async () => {
    try { await fb.signOut(sessao.auth); } catch (e) { /* tanto faz */ }
    esquecerMesa(); try { localStorage.removeItem('artemis_vinculo'); } catch (e) { /* tanto faz */ }
    location.reload();
  });

  if (!sessao.mesa) {
    status('ok', 'Conectado à Artemis');
    $('cenaAtual').textContent = 'Para entrar na mesa, use o comando /mesa no Discord e abra o link.';
    return;
  }
  status('ok', 'Conectado à Artemis');
  $('seloMesaTxt').textContent = 'Mesa aberta';
  if (sessao.mestre) $('atFichas').hidden = false;
  $('atividade').hidden = false;
  if (nome) $('ola').textContent = 'Olá, ' + nome.split(' ')[0];

  const base = ['servidores', s];
  const erro = (e) => console.warn('Início: sem acesso a parte dos dados', e);

  // campanha e cena atual
  fb.onSnapshot(fb.doc(db, ...base, 'mesa', 'estado'), (d) => {
    const e = d.exists() ? d.data() : {};
    if (e.campanha) $('campanha').textContent = e.campanha;
    $('proxima').textContent = e.proxima || 'a combinar';
    $('cenaAtual').textContent = e.cenaNome ? `Cena atual: ${e.cenaNome}` : 'Nenhuma cena ativa ainda.';
    const m = $('miniatura');
    if (e.cenaMapa) { m.classList.add('com-mapa'); m.style.backgroundImage = `url("${String(e.cenaMapa).replace(/["\\\n\r]/g, encodeURIComponent)}")`; m.innerHTML = ''; }
  }, erro);

  // quem está na mesa agora
  fb.onSnapshot(fb.collection(db, ...base, 'mesa_presenca'), (snap) => {
    const agora = Date.now();
    const gente = [];
    snap.forEach((d) => { const p = d.data(); if (agora - (p.visto || 0) < 90000) gente.push(p); });
    gente.sort((a, b) => (b.mestre ? 1 : 0) - (a.mestre ? 1 : 0) || String(a.nome).localeCompare(String(b.nome)));
    $('gente').innerHTML = gente.length
      ? gente.map((p) => `<div class="p"><b style="background:${esc(p.cor || corDe(p.nome))}">${esc(p.sigla || sigla(p.nome))}</b>${esc(p.nome)}<small>${p.mestre ? 'mestre' : 'jogador'}</small></div>`).join('')
      : '<span class="vazio" style="font-size:13px;color:#a6a6a6">Ninguém conectado agora.</span>';
    const vivo = gente.length > 0;
    $('seloMesa').classList.toggle('vivo', vivo);
    $('seloMesaTxt').textContent = vivo ? `Sessão ao vivo · ${gente.length} conectado${gente.length > 1 ? 's' : ''}` : 'Mesa aberta';
  }, erro);

  // atividade recente
  try {
    const q = fb.query(fb.collection(db, ...base, 'mesa_atividade'), fb.orderBy('criado', 'desc'), fb.limit(5));
    fb.onSnapshot(q, (snap) => {
      const linhas = [];
      snap.forEach((d) => { const a = d.data(); const ms = a.criado && a.criado.toMillis ? a.criado.toMillis() : (Number(a.criado) || 0); linhas.push(`<div class="lin"><span>${esc(a.texto)}</span><span>${quando(ms)}</span></div>`); });
      $('atividadeLista').innerHTML = linhas.join('') || '<div class="vazio">Nada por aqui ainda.</div>';
    }, erro);
  } catch (e) { erro(e); }
}

ligarMenu();
mostrarFicha();
mostrarLivro();
if (servidorSalvo()) status('', 'Conectando...');
ligarOnline().catch((e) => { console.error(e); status('erro', 'Não consegui conectar. Recarregue a página.'); });
