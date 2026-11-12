/* ==========================================================================
   MESA — a tela (mini-Miro para mestrar)
   --------------------------------------------------------------------------
   - Mapa por link, bonecos ligados às fichas, notas, desenho e cenas.
   - O mestre vê tudo; jogadores só veem a cena ativa e o que não está oculto.
   - Jogador só mexe no próprio boneco (e nas próprias notas e traços).
   - Sem o link da Artemis (/mesa) abre em modo de teste, só neste navegador.
   Os dados ficam em mesa-dados.js (Firestore ou localStorage).
   ========================================================================== */
import { abrirSessao, firebaseConfigurado, servidorSalvo, esquecerMesa } from './bhc-firebase.js';
import { criarLocal, criarFirebase } from './mesa-dados.js';

const $ = (id) => document.getElementById(id);
const ler = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

const CORES_BONECO = ['#CC0000', '#F3E6D4', '#D9DEEB', '#A24BD6', '#CC7A00', '#6AA8FF', '#7FD6A8', '#ff9fb0'];
const CORES_DESENHO = ['#FF3131', '#F3E6D4', '#ffffff', '#4da3ff', '#7FD6A8', '#CC7A00', '#b36bff'];
const CORES_NOTA = ['#F3E6D4', '#F2D66B', '#D9DEEB', '#ff9fb0', '#7FD6A8'];
const TAMANHOS = { P: 0.75, M: 1, G: 1.8 }; // multiplicadores; o tamanho real depende do mapa (ver tamanhoPx)
const MUNDO_PADRAO = { w: 1600, h: 1000 };
const FERR_NOMES = { sel: 'Selecionar e mover', mov: 'Mover a tela', tok: 'Boneco', note: 'Nota', draw: 'Desenhar', img: 'Imagem do mapa' };

const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sigla = (nome) => {
  const p = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  if (p.length > 1) return (p[0][0] + p[1][0]).toUpperCase();
  return (p[0] || '?').slice(0, 2).toUpperCase();
};
const CORES_PESSOA = ['#F3E6D4', '#D9DEEB', '#A24BD6', '#6AA8FF', '#E8A25A', '#7FD6A8', '#ff9fb0'];
const corDe = (txt) => { let h = 0; for (const c of String(txt)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CORES_PESSOA[h % CORES_PESSOA.length]; };
const urlSegura = (u) => {
  const t = String(u || '').trim();
  return /^(https?:\/\/|data:image\/)/i.test(t) ? t : '';
};
const cssUrl = (u) => `url('${String(u).replace(/['"\\\n\r()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))}')`;
const textoSobre = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#000';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
  return lum > 140 ? '#000' : '#fff';
};

/* ==========================================================================
   ESTADO
   ========================================================================== */
const S = {
  db: null, uid: 'local', mestre: true, mesaOk: true, sessao: null,
  nome: 'Você',
  estado: {}, cenas: [], cenaVistaId: null,
  itens: new Map(),
  itensDe: null, desligaItens: null,
  presenca: [], fichas: [], desligaFichas: null, desligaFichasProprias: new Map(),
  fichasProprias: new Map(),
  sel: null, tool: 'sel', aba: 'cenas', ver: 'mestre',
  vp: { x: 0, y: 0, z: 1 },
  mapa: { src: '', w: MUNDO_PADRAO.w, h: MUNDO_PADRAO.h, ok: false },
  desenho: { cor: CORES_DESENHO[0], larg: 4 },
  painelAberto: false,
  editandoNota: null,
  ultimaCena: null,
};
const els = new Map();       // id do item -> elemento
let ptrs = new Map();        // ponteiros ativos (toque/mouse)
let gesto = null;            // o que está acontecendo agora (arrastar, desenhar, mover a tela, pinça)
const escritas = new Map();  // limitador de gravações durante o arrastar

const ativa = () => S.cenas.find((c) => c.ativa) || (S.estado.cenaAtiva ? S.cenas.find((c) => c.id === S.estado.cenaAtiva) : null) || null;
const mestreVendo = () => S.mestre && S.ver === 'mestre';
function cenaMostrada() {
  if (mestreVendo()) return S.cenas.find((c) => c.id === S.cenaVistaId) || ativa() || S.cenas[0] || null;
  return ativa();
}
const itensVisiveis = () => [...S.itens.values()].filter((i) => mestreVendo() || !i.oculto);
const podeMover = (i) => i && (S.mestre || (i.dono === S.uid && (i.tipo === 'boneco' || i.tipo === 'nota')));
const podeApagar = (i) => i && (S.mestre || (i.dono === S.uid && (i.tipo === 'nota' || i.tipo === 'traco')));
const podeVida = (i) => i && i.tipo === 'boneco' && (S.mestre || (i.dono === S.uid && i.ficha));
const itemSel = () => (S.sel ? S.itens.get(S.sel) : null);
function tamanhoPx(k) {
  const mult = TAMANHOS[k] || 1;
  const g = grade();
  if (g) return Math.round(g * 0.9 * mult);
  return Math.round(clamp(S.mapa.w / 28, 36, 220) * mult);
}
const grade = () => { const c = cenaMostrada(); return c && c.grade ? Math.max(10, Number(c.gradeTam) || 50) : 0; };

/* ==========================================================================
   AGENDAMENTO DE DESENHO NA TELA
   ========================================================================== */
const pendente = new Set();
function agendar(nome) {
  if (pendente.has(nome)) return;
  pendente.add(nome);
  requestAnimationFrame(() => {
    pendente.delete(nome);
    if (nome === 'itens') renderItens();
    else if (nome === 'painel') renderPainel();
    else if (nome === 'cabeca') renderCabecalho();
    else if (nome === 'cena') renderCena();
  });
}

/* ==========================================================================
   VISÃO (mover e dar zoom)
   ========================================================================== */
function aplicarVp() {
  $('mundo').style.transform = `translate(${S.vp.x}px, ${S.vp.y}px) scale(${S.vp.z})`;
  $('zTxt').textContent = Math.round(S.vp.z * 100) + '%';
}
function paraMundo(cx, cy) {
  const r = $('tela').getBoundingClientRect();
  return { x: (cx - r.left - S.vp.x) / S.vp.z, y: (cy - r.top - S.vp.y) / S.vp.z };
}
function centroDaTela() {
  const r = $('tela').getBoundingClientRect();
  return paraMundo(r.left + r.width / 2, r.top + r.height / 2);
}
function zoomEm(cx, cy, novoZ) {
  const r = $('tela').getBoundingClientRect();
  const z = clamp(novoZ, 0.1, 4);
  const px = cx - r.left, py = cy - r.top;
  S.vp.x = px - ((px - S.vp.x) / S.vp.z) * z;
  S.vp.y = py - ((py - S.vp.y) / S.vp.z) * z;
  S.vp.z = z;
  aplicarVp();
}
function ajustar() {
  const r = $('tela').getBoundingClientRect();
  const w = S.mapa.w, h = S.mapa.h;
  const z = clamp(Math.min((r.width - 40) / w, (r.height - 40) / h), 0.1, 1.5);
  S.vp.z = z;
  S.vp.x = (r.width - w * z) / 2;
  S.vp.y = (r.height - h * z) / 2;
  aplicarVp();
}
function centralizarEm(x, y) {
  const r = $('tela').getBoundingClientRect();
  S.vp.x = r.width / 2 - x * S.vp.z;
  S.vp.y = r.height / 2 - y * S.vp.z;
  aplicarVp();
}

/* ==========================================================================
   CENA (mapa e grade)
   ========================================================================== */
function renderCena() {
  const c = cenaMostrada();
  const key = c ? c.id : null;
  const img = $('mapaImg');
  const src = c ? urlSegura(c.mapa) : '';
  const escala = c ? Math.max(10, Number(c.escala) || 100) : 100;

  if (src !== S.mapa.src || key !== S.ultimaCena) {
    S.mapa = { src, w: MUNDO_PADRAO.w, h: MUNDO_PADRAO.h, ok: false };
    if (src) {
      img.hidden = false;
      img.onload = () => {
        S.mapa.w = img.naturalWidth * escala / 100; S.mapa.h = img.naturalHeight * escala / 100; S.mapa.ok = true;
        img.style.width = S.mapa.w + 'px'; renderGrade();
        if (S.ultimaCena === key) ajustar();
        avisos();
      };
      img.onerror = () => { S.mapa.ok = false; img.hidden = true; avisos('Não consegui abrir a imagem do mapa. Confira o link (precisa ser o endereço direto da imagem).'); };
      img.src = src;
    } else { img.hidden = true; img.removeAttribute('src'); }
    if (key !== S.ultimaCena) { S.ultimaCena = key; if (!src) ajustar(); }
  } else if (src && img.naturalWidth) {
    S.mapa.w = img.naturalWidth * escala / 100; S.mapa.h = img.naturalHeight * escala / 100;
    img.style.width = S.mapa.w + 'px';
  }
  renderGrade();
  avisos();
}

function renderGrade() {
  const g = grade();
  const el = $('grade');
  if (!g) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = '0px'; el.style.top = '0px'; el.style.width = S.mapa.w + 'px'; el.style.height = S.mapa.h + 'px';
  el.style.backgroundImage = 'linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.16) 1px, transparent 1px)';
  el.style.backgroundSize = `${g}px ${g}px`;
  el.style.backgroundPosition = '0 0';
}

let erroMapa = '';
function avisos(erro) {
  if (erro !== undefined) erroMapa = erro;
  const topo = $('avisoTopo'), centro = $('avisoCentro');
  const c = cenaMostrada();
  topo.hidden = true; centro.hidden = true;

  if (!S.mesaOk) {
    centro.hidden = false;
    centro.innerHTML = '<div><strong>Você ainda não entrou na mesa</strong>No Discord, use o comando <b>/mesa</b> e abra o link que a Artemis mandar.<br><a class="bhc-btn" href="./">Voltar ao início</a></div>';
    return;
  }
  if (!c) {
    centro.hidden = false;
    centro.innerHTML = S.mestre
      ? '<div><strong>Nenhuma cena ainda</strong>Crie a primeira cena colando o link de um mapa.<br><button class="bhc-btn verm" type="button" id="avisoNova">Nova cena</button></div>'
      : '<div><strong>Aguardando o mestre</strong>O mestre ainda não mostrou nenhuma cena.</div>';
    const b = $('avisoNova'); if (b) b.onclick = () => dialogoCena(null);
    return;
  }
  if (S.mestre && S.ver === 'jogador') {
    topo.hidden = false; topo.textContent = 'Visão dos jogadores: é assim que eles veem a mesa';
  } else if (S.mestre && !c.ativa) {
    topo.hidden = false;
    topo.innerHTML = '<span>Preparando esta cena: os jogadores ainda não a veem</span><button type="button" id="avisoMostrar">Mostrar para todos</button>';
    $('avisoMostrar').onclick = () => ativarCena(c.id);
  } else if (erroMapa) {
    topo.hidden = false; topo.textContent = erroMapa;
  }
}

/* ==========================================================================
   ITENS NO MAPA (bonecos, notas, traços)
   ========================================================================== */
function criarElBoneco(id) {
  const d = document.createElement('div');
  d.className = 'bn'; d.dataset.id = id;
  d.innerHTML = '<div class="cc"></div><div class="hp"><i></i></div><div class="nm"></div>';
  return d;
}
function criarElNota(id) {
  const d = document.createElement('div');
  d.className = 'nt'; d.dataset.id = id;
  return d;
}

function atualizarBoneco(el, it) {
  const t = Number(it.tamanho) || tamanhoPx('M');
  const cc = el.firstChild, hp = el.children[1], nm = el.children[2];
  el.style.left = (Number(it.x) || 0) + 'px'; el.style.top = (Number(it.y) || 0) + 'px';
  cc.style.width = cc.style.height = t + 'px';
  cc.style.fontSize = Math.max(11, Math.round(t / 3.4)) + 'px';
  const img = urlSegura(it.imagem);
  cc.style.backgroundColor = it.cor || '#CC0000';
  cc.style.backgroundImage = img ? cssUrl(img) : 'none';
  cc.style.color = it.corTexto || textoSobre(it.cor);
  cc.textContent = img ? '' : (it.sigla || sigla(it.nome));
  const v = it.vida;
  hp.style.display = v && v.max ? '' : 'none';
  hp.style.width = t + 'px';
  if (v && v.max) hp.firstChild.style.width = clamp(Math.round((v.atual / v.max) * 100), 0, 100) + '%';
  nm.textContent = it.nome || '';
  el.classList.toggle('sel', S.sel === it.id);
  el.classList.toggle('oculto', !!it.oculto);
  el.classList.toggle('bloq', !podeMover(it));
}

function atualizarNota(el, it) {
  el.style.left = (Number(it.x) || 0) + 'px'; el.style.top = (Number(it.y) || 0) + 'px';
  el.style.width = (Number(it.w) || 180) + 'px';
  el.style.background = it.cor || CORES_NOTA[0];
  el.classList.toggle('sel', S.sel === it.id);
  el.classList.toggle('oculto', !!it.oculto);
  el.classList.toggle('bloq', !podeMover(it));
  if (S.editandoNota === it.id) return; // não atropela o texto que está sendo digitado
  el.innerHTML = (it.oculto ? '<span class="quem">Só o mestre vê</span>' : '') + esc(it.texto || '');
  if (!it.texto) el.innerHTML += '<span style="opacity:.45">(nota vazia: clique duas vezes para escrever)</span>';
}

function renderItens() {
  const vis = itensVisiveis();
  const vistos = new Set();
  const camada = $('camada');
  const tracos = [];

  vis.forEach((it) => {
    if (it.tipo === 'traco') { tracos.push(it); return; }
    vistos.add(it.id);
    let el = els.get(it.id);
    if (!el || el.dataset.tipo !== it.tipo) {
      if (el) el.remove();
      el = it.tipo === 'boneco' ? criarElBoneco(it.id) : criarElNota(it.id);
      el.dataset.tipo = it.tipo;
      camada.appendChild(el);
      els.set(it.id, el);
    }
    if (gesto && gesto.tipo === 'item' && gesto.id === it.id) {
      // enquanto arrasta, a posição vale a do dedo/mouse, não a do banco
      const o = { ...it, x: gesto.x, y: gesto.y };
      it.tipo === 'boneco' ? atualizarBoneco(el, o) : atualizarNota(el, o);
    } else {
      it.tipo === 'boneco' ? atualizarBoneco(el, it) : atualizarNota(el, it);
    }
  });
  [...els.keys()].forEach((id) => { if (!vistos.has(id)) { els.get(id).remove(); els.delete(id); } });

  // traços
  const svg = $('tracos');
  let html = '';
  tracos.forEach((t) => {
    const p = t.pontos || [];
    if (p.length < 2) return;
    let d = `M${p[0]} ${p[1]}`;
    if (p.length === 2) d += ` L${p[0] + 0.01} ${p[1]}`;
    for (let i = 2; i < p.length; i += 2) d += ` L${p[i]} ${p[i + 1]}`;
    const sel = S.sel === t.id ? ' sel' : '';
    html += `<path class="vis${sel}" d="${d}" stroke="${esc(t.cor || '#FF3131')}" stroke-width="${Number(t.larg) || 4}" opacity="${t.oculto ? .55 : 1}"${t.oculto ? ' stroke-dasharray="8 6"' : ''}/>`;
    html += `<path class="hit" data-id="${esc(t.id)}" d="${d}" stroke-width="${Math.max(16, (Number(t.larg) || 4) + 10)}"/>`;
  });
  svg.innerHTML = html + '<g id="tracoVivo"></g>';
}

/* ==========================================================================
   GESTOS (mouse, toque, caneta)
   ========================================================================== */
const tela = () => $('tela');
const noControle = (alvo) => alvo.closest('.zoom, .opcoes-desenho, .aviso-topo, .aviso-centro, .cartao-sel, .chip-ferr, textarea');

function iniciarPinca() {
  const pts = [...ptrs.values()];
  const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
  gesto = { tipo: 'pinca', dist: Math.hypot(dx, dy), z: S.vp.z };
}

function aoApertar(e) {
  if (noControle(e.target)) return;
  if (S.mesaOk === false) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  tela().setPointerCapture(e.pointerId);
  if (ptrs.size === 2) { finalizarGesto(true); iniciarPinca(); return; }
  if (ptrs.size > 2) return;

  const alvoId = e.target.closest('[data-id]') ? e.target.closest('[data-id]').dataset.id : null;
  const it = alvoId ? S.itens.get(alvoId) : null;
  const ferr = e.button === 1 ? 'mov' : S.tool;
  const m = paraMundo(e.clientX, e.clientY);

  if (ferr === 'draw') {
    gesto = { tipo: 'traco', pontos: [round1(m.x), round1(m.y)], ultimo: m };
    desenharVivo();
    return;
  }
  if (ferr === 'note' && !it) {
    criarNotaEm(m.x, m.y);
    return;
  }
  if (ferr === 'mov') {
    gesto = { tipo: 'pan', x0: e.clientX, y0: e.clientY, vx: S.vp.x, vy: S.vp.y };
    tela().classList.add('arrastando');
    return;
  }
  // selecionar / mover
  if (it) {
    selecionar(it.id);
    if (podeMover(it) && it.tipo !== 'traco') {
      gesto = { tipo: 'item', id: it.id, dx: m.x - (Number(it.x) || 0), dy: m.y - (Number(it.y) || 0), x: Number(it.x) || 0, y: Number(it.y) || 0, moveu: false, cx: e.clientX, cy: e.clientY };
    }
    return;
  }
  selecionar(null);
  gesto = { tipo: 'pan', x0: e.clientX, y0: e.clientY, vx: S.vp.x, vy: S.vp.y };
  tela().classList.add('arrastando');
}

function aoMover(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesto) return;

  if (gesto.tipo === 'pinca' && ptrs.size >= 2) {
    const pts = [...ptrs.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoomEm((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, gesto.z * (dist / Math.max(1, gesto.dist)));
    return;
  }
  if (gesto.tipo === 'pan') {
    S.vp.x = gesto.vx + (e.clientX - gesto.x0);
    S.vp.y = gesto.vy + (e.clientY - gesto.y0);
    aplicarVp();
  } else if (gesto.tipo === 'item') {
    if (!gesto.moveu && Math.hypot(e.clientX - gesto.cx, e.clientY - gesto.cy) < 4) return;
    gesto.moveu = true;
    const m = paraMundo(e.clientX, e.clientY);
    gesto.x = round1(m.x - gesto.dx); gesto.y = round1(m.y - gesto.dy);
    const el = els.get(gesto.id);
    if (el) { el.style.left = gesto.x + 'px'; el.style.top = gesto.y + 'px'; }
    { const cid = cenaMostrada().id, iid = gesto.id, gx = gesto.x, gy = gesto.y; gravarLimitado('mov' + iid, () => S.db.itens.salvar(cid, iid, { x: gx, y: gy })); }
  } else if (gesto.tipo === 'traco') {
    const m = paraMundo(e.clientX, e.clientY);
    if (Math.hypot(m.x - gesto.ultimo.x, m.y - gesto.ultimo.y) * S.vp.z < 3) return;
    gesto.pontos.push(round1(m.x), round1(m.y));
    gesto.ultimo = m;
    desenharVivo();
  }
}

function aoSoltar(e) {
  const tinha = ptrs.has(e.pointerId);
  ptrs.delete(e.pointerId);
  if (!tinha) return;
  if (gesto && gesto.tipo === 'pinca') { if (ptrs.size < 2) gesto = null; return; }
  finalizarGesto(false);
}

function finalizarGesto(cancelar) {
  const g = gesto; gesto = null;
  if (g && g.tipo === 'item') { const e = escritas.get('mov' + g.id); if (e) clearTimeout(e.timer); }
  tela().classList.remove('arrastando');
  if (!g) return;
  if (g.tipo === 'item') {
    if (g.moveu && !cancelar) {
      let { x, y } = g;
      const it = S.itens.get(g.id);
      const gr = grade();
      if (gr && it && it.tipo === 'boneco') { x = (Math.floor(x / gr) + 0.5) * gr; y = (Math.floor(y / gr) + 0.5) * gr; }
      const cena = cenaMostrada();
      if (it) { it.x = x; it.y = y; }
      if (cena) S.db.itens.salvar(cena.id, g.id, { x, y });
      agendar('itens');
    } else if (!g.moveu && !cancelar) {
      agendar('itens');
    }
  } else if (g.tipo === 'traco') {
    if (!cancelar) salvarTraco(g.pontos);
    const v = $('tracoVivo'); if (v) v.innerHTML = '';
  }
}

function aoRodar(e) {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  zoomEm(e.clientX, e.clientY, S.vp.z * f);
}

function round1(n) { return Math.round(n * 10) / 10; }

function gravarLimitado(chave, fn) {
  const e = escritas.get(chave) || { t: 0, timer: null };
  const agora = Date.now();
  clearTimeout(e.timer);
  if (agora - e.t > 120) { e.t = agora; fn(); }
  else e.timer = setTimeout(() => { e.t = Date.now(); fn(); }, 120);
  escritas.set(chave, e);
}

function desenharVivo() {
  const v = $('tracoVivo');
  if (!v || !gesto || gesto.tipo !== 'traco') return;
  const p = gesto.pontos;
  let d = `M${p[0]} ${p[1]}`;
  if (p.length === 2) d += ` L${p[0] + 0.01} ${p[1]}`;
  for (let i = 2; i < p.length; i += 2) d += ` L${p[i]} ${p[i + 1]}`;
  v.innerHTML = `<path class="vis" d="${d}" stroke="${S.desenho.cor}" stroke-width="${S.desenho.larg}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

async function salvarTraco(pontos) {
  const cena = cenaMostrada();
  if (!cena || !S.mesaOk) return;
  let p = pontos;
  if (p.length > 1200) { // 600 pontos no máximo: tira alguns do meio
    const passo = Math.ceil(p.length / 1200);
    const q = [];
    for (let i = 0; i < p.length; i += 2 * passo) q.push(p[i], p[i + 1]);
    q.push(p[p.length - 2], p[p.length - 1]);
    p = q;
  }
  const id = await S.db.itens.criar(cena.id, { tipo: 'traco', pontos: p, cor: S.desenho.cor, larg: S.desenho.larg, dono: S.uid, x: 0, y: 0, oculto: false });
  if (S.db.tipo === 'local') return;
  void id;
}

/* ==========================================================================
   SELEÇÃO
   ========================================================================== */
function selecionar(id) {
  S.sel = id;
  if (S.editandoNota && S.editandoNota !== id) fecharEdicaoNota(true);
  agendar('itens'); agendar('painel');
  atualizarCartaoCelular();
}

/* ==========================================================================
   NOTAS
   ========================================================================== */
async function criarNotaEm(x, y) {
  const cena = cenaMostrada();
  if (!cena) return;
  const id = await S.db.itens.criar(cena.id, { tipo: 'nota', x: round1(x), y: round1(y), w: 180, texto: '', cor: CORES_NOTA[0], dono: S.uid });
  definirFerramenta('sel');
  selecionar(id);
  setTimeout(() => abrirEdicaoNota(id), 80);
}

function abrirEdicaoNota(id) {
  const it = S.itens.get(id);
  const el = els.get(id);
  if (!it || !el || !podeMover(it)) return;
  S.editandoNota = id;
  el.innerHTML = '<textarea aria-label="Texto da nota"></textarea>';
  const ta = el.firstChild;
  ta.value = it.texto || '';
  ta.focus();
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); fecharEdicaoNota(true); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); fecharEdicaoNota(true); }
    ev.stopPropagation();
  });
  ta.addEventListener('blur', () => fecharEdicaoNota(true));
}

function fecharEdicaoNota(salvar) {
  const id = S.editandoNota;
  if (!id) return;
  const el = els.get(id);
  const ta = el && el.querySelector('textarea');
  S.editandoNota = null;
  if (ta && salvar) {
    const it = S.itens.get(id);
    const texto = ta.value.slice(0, 1500);
    if (it && texto !== (it.texto || '')) { it.texto = texto; const c = cenaMostrada(); if (c) S.db.itens.salvar(c.id, id, { texto }); }
  }
  agendar('itens'); agendar('painel');
}

/* ==========================================================================
   FERRAMENTAS
   ========================================================================== */
function definirFerramenta(t) {
  if (t === 'tok' && !S.mestre) t = 'sel';
  S.tool = t;
  document.querySelectorAll('#ferr [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const el = tela();
  ['sel', 'mov', 'tok', 'note', 'draw', 'img'].forEach((n) => el.classList.toggle('t-' + n, n === t));
  $('ferrNome').textContent = FERR_NOMES[t] || '';
  $('opcoesDesenho').hidden = t !== 'draw';
  if (t === 'tok') { dialogoBoneco(); definirFerramenta('sel'); }
  if (t === 'img') { dialogoCena(cenaMostrada()); definirFerramenta('sel'); }
}

/* ==========================================================================
   CENAS
   ========================================================================== */
async function ativarCena(id) {
  const c = S.cenas.find((x) => x.id === id);
  if (!c) return;
  await S.db.cenas.ativar(id, { cenaAtiva: id, cenaNome: c.nome || 'Cena', cenaMapa: urlSegura(c.mapa) || null });
  S.cenaVistaId = id;
  S.db.atividade.registrar(`O mestre trocou a cena para ${c.nome || 'uma nova cena'}`);
}

/* ==========================================================================
   BONECOS
   ========================================================================== */
async function colocarBoneco(dados) {
  const cena = cenaMostrada();
  if (!cena) { avisos(); return null; }
  const c = centroDaTela();
  const offset = (S.itens.size % 6) * 14; // não empilha exatamente no mesmo lugar
  const id = await S.db.itens.criar(cena.id, { tipo: 'boneco', x: round1(c.x + offset), y: round1(c.y + offset), ...dados });
  return id;
}

async function ajustarVida(it, d) {
  if (!podeVida(it) || !it.vida) return;
  const novo = clamp((Number(it.vida.atual) || 0) + d, 0, Number(it.vida.max) || 0);
  const cena = cenaMostrada();
  const ficha = it.ficha ? (S.fichas.find((f) => f.id === it.ficha) || S.fichasProprias.get(it.ficha)) : null;
  if (ficha && ficha.barras) {
    const barras = JSON.parse(JSON.stringify(ficha.barras));
    barras.vida = { atual: novo, max: Number(ficha.barras.vida?.max) || it.vida.max };
    await S.db.fichas.salvarBarras(ficha.id, barras); // a ficha primeiro; o boneco acompanha
    ficha.barras = barras;
  }
  it.vida = { atual: novo, max: it.vida.max };
  if (cena) S.db.itens.salvar(cena.id, it.id, { vida: it.vida });
  agendar('itens'); agendar('painel');
}

/* o boneco acompanha a Vida da ficha (mestre vê todas; jogador, só a dele) */
function espelharVida() {
  const cena = cenaMostrada();
  if (!cena || S.db.tipo === 'local') return;
  const todas = new Map([...S.fichasProprias, ...S.fichas.map((f) => [f.id, f])]);
  S.itens.forEach((it) => {
    if (it.tipo !== 'boneco' || !it.ficha) return;
    if (!S.mestre && it.dono !== S.uid) return;
    const f = todas.get(it.ficha);
    const v = f && f.barras && f.barras.vida;
    if (!v) return;
    const atual = Number(v.atual) || 0, max = Number(v.max) || 0;
    if (!it.vida || it.vida.atual !== atual || it.vida.max !== max) {
      S.db.itens.salvar(cena.id, it.id, { vida: { atual, max } });
    }
  });
}

function observarFichasProprias() {
  if (S.db.tipo === 'local' || S.mestre) return;
  const meus = new Set([...S.itens.values()].filter((i) => i.tipo === 'boneco' && i.ficha && i.dono === S.uid).map((i) => i.ficha));
  meus.forEach((id) => {
    if (S.desligaFichasProprias.has(id)) return;
    S.desligaFichasProprias.set(id, S.db.fichas.ouvir(id, (f) => {
      if (f) S.fichasProprias.set(id, f); else S.fichasProprias.delete(id);
      espelharVida(); agendar('painel');
    }));
  });
}

/* ==========================================================================
   LINKS PARA A FICHA
   ========================================================================== */
function linkFicha(it) {
  const s = S.sessao && S.sessao.s;
  if (!it.ficha || !s) return 'ficha.html';
  return it.dono === S.uid
    ? `ficha.html?s=${encodeURIComponent(s)}&f=${encodeURIComponent(it.ficha)}`
    : `ficha.html?s=${encodeURIComponent(s)}&f=${encodeURIComponent(it.ficha)}&temp=1`;
}

/* ==========================================================================
   PAINEL
   ========================================================================== */
function abrirPainel(v) {
  S.painelAberto = v;
  $('painel').classList.toggle('aberto', v);
  atualizarCartaoCelular();
}

function renderPainel() {
  // visão como
  $('blocoVer').hidden = !S.mestre;
  document.querySelectorAll('#segVer [data-ver]').forEach((b) => b.classList.toggle('on', b.dataset.ver === S.ver));
  document.querySelectorAll('[data-so-mestre]').forEach((b) => { b.hidden = !S.mestre; });
  renderSelecionado();
  document.querySelectorAll('#abas [data-aba]').forEach((b) => b.classList.toggle('on', b.dataset.aba === S.aba));
  const c = $('conteudo');
  if (S.aba === 'cenas') c.innerHTML = htmlCenas();
  else if (S.aba === 'bonecos') c.innerHTML = htmlBonecos();
  else if (S.aba === 'notas') c.innerHTML = htmlNotas();
  else if (S.aba === 'fichas') c.innerHTML = htmlFichas();
}

function htmlBarra(v) {
  if (!v || !v.max) return '';
  const pct = clamp(Math.round((v.atual / v.max) * 100), 0, 100);
  return `<div class="pn-barra"><span>Vida</span><div class="tr"><i style="width:${pct}%"></i></div><span>${v.atual}/${v.max}</span></div>`;
}

function renderSelecionado() {
  const b = $('blocoSel');
  const it = itemSel();
  if (!it || (!mestreVendo() && it.oculto)) { b.innerHTML = ''; return; }
  if (it.tipo === 'boneco') {
    const img = urlSegura(it.imagem);
    const tipo = it.ficha ? 'Personagem de jogador' : 'NPC';
    let h = `<span class="pn-rot">Boneco selecionado</span>
      <div class="pn-linha"><span class="pn-av" style="background-color:${esc(it.cor || '#CC0000')};color:${textoSobre(it.cor)};${img ? 'background-image:' + cssUrl(img) : ''}">${img ? '' : esc(it.sigla || sigla(it.nome))}</span>
      <div class="t"><strong>${esc(it.nome)}</strong><span>${tipo}${it.oculto ? ' · oculto dos jogadores' : ''}</span></div></div>
      ${htmlBarra(it.vida)}`;
    if (podeVida(it) && it.vida) h += '<div class="pn-botoes"><button class="bhc-btn" type="button" data-acao="vida-" >Vida −1</button><button class="bhc-btn" type="button" data-acao="vida+">Vida +1</button></div>';
    if (it.ficha && (S.mestre || it.dono === S.uid) && S.db.tipo !== 'local') h += `<a class="bhc-btn verm" href="${esc(linkFicha(it))}">Abrir ficha</a>`;
    if (S.mestre) h += `<div class="pn-botoes"><button class="bhc-btn mini" type="button" data-acao="ocultar">${it.oculto ? 'Revelar' : 'Ocultar'}</button><button class="bhc-btn mini" type="button" data-acao="editar">Editar</button><button class="bhc-btn mini perigo" type="button" data-acao="apagar">Tirar da mesa</button></div>`;
    b.innerHTML = h;
  } else if (it.tipo === 'nota') {
    let h = `<span class="pn-rot">Nota selecionada</span><div class="pn-ajuda">Clique duas vezes na nota para escrever.</div>`;
    if (podeMover(it)) h += `<div class="cores-sel">${CORES_NOTA.map((c) => `<button type="button" data-cor-nota="${c}" class="${it.cor === c ? 'on' : ''}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('')}</div>`;
    h += '<div class="pn-botoes">';
    if (podeMover(it)) h += '<button class="bhc-btn mini" type="button" data-acao="escrever">Escrever</button>';
    if (S.mestre) h += `<button class="bhc-btn mini" type="button" data-acao="ocultar">${it.oculto ? 'Revelar' : 'Ocultar'}</button>`;
    if (podeApagar(it)) h += '<button class="bhc-btn mini perigo" type="button" data-acao="apagar">Apagar</button>';
    h += '</div>';
    b.innerHTML = h;
  } else if (it.tipo === 'traco') {
    b.innerHTML = `<span class="pn-rot">Desenho selecionado</span><div class="pn-botoes">${S.mestre ? `<button class="bhc-btn mini" type="button" data-acao="ocultar">${it.oculto ? 'Revelar' : 'Ocultar'}</button>` : ''}${podeApagar(it) ? '<button class="bhc-btn mini perigo" type="button" data-acao="apagar">Apagar desenho</button>' : '<span class="pn-ajuda">Só quem desenhou (ou o mestre) apaga.</span>'}</div>`;
  } else b.innerHTML = '';
}

function htmlCenas() {
  const mostrada = cenaMostrada();
  const lista = S.mestre ? S.cenas : S.cenas.filter((c) => c.ativa);
  const ordenadas = [...lista].sort((a, b) => (b.ativa ? 1 : 0) - (a.ativa ? 1 : 0) || (a.criado || 0) - (b.criado || 0));
  let h = ordenadas.map((c) => {
    const bg = urlSegura(c.mapa) ? `background-image:${cssUrl(c.mapa)}` : '';
    const on = mostrada && mostrada.id === c.id;
    let item = `<button type="button" class="pn-item${on ? ' on' : ''}" data-cena="${esc(c.id)}" ${S.mestre ? '' : 'disabled'} style="${c.ativa ? 'border-color:#fff' : ''}"><div class="mini" style="${bg}"></div><div class="t"><strong>${esc(c.nome || 'Cena')}</strong><span>${c.ativa ? 'Ativa para todos' : 'Só o mestre vê'}</span></div></button>`;
    if (S.mestre && on) {
      item += `<div class="pn-botoes" style="margin-top:-2px">${c.ativa ? '' : `<button class="bhc-btn verm mini" type="button" data-acao="cena-ativar" data-id="${esc(c.id)}">Mostrar para todos</button>`}<button class="bhc-btn mini" type="button" data-acao="cena-editar" data-id="${esc(c.id)}">Editar</button><button class="bhc-btn mini perigo" type="button" data-acao="cena-apagar" data-id="${esc(c.id)}">Apagar</button></div>`;
    }
    return item;
  }).join('');
  if (!ordenadas.length) h = `<div class="pn-vazio">${S.mestre ? 'Nenhuma cena ainda.' : 'O mestre ainda não mostrou nenhuma cena.'}</div>`;
  if (S.mestre) h += '<button class="pn-novo" type="button" data-acao="cena-nova">Nova cena (colar link do mapa)</button>';
  return h;
}

function htmlBonecos() {
  const bons = itensVisiveis().filter((i) => i.tipo === 'boneco');
  let h = bons.map((b) => {
    const img = urlSegura(b.imagem);
    return `<button type="button" class="pn-item${S.sel === b.id ? ' on' : ''}" data-boneco="${esc(b.id)}"><span class="dot" style="background-color:${esc(b.cor || '#CC0000')};color:${textoSobre(b.cor)};${img ? 'background-image:' + cssUrl(img) : ''}">${img ? '' : esc(b.sigla || sigla(b.nome))}</span><span class="t"><strong>${esc(b.nome)}</strong><span>${b.ficha ? 'Jogador' : 'NPC'}${b.oculto ? ' · oculto' : ''}</span></span><span class="hpt">${b.vida ? b.vida.atual + '/' + b.vida.max : ''}</span></button>`;
  }).join('');
  if (!bons.length) h = '<div class="pn-vazio">Nenhum boneco nesta cena.</div>';
  if (S.mestre) h += '<button class="pn-novo" type="button" data-acao="boneco-novo">Adicionar NPC ou monstro</button>';
  return h;
}

function htmlNotas() {
  const notas = itensVisiveis().filter((i) => i.tipo === 'nota');
  let h = notas.map((n) => `<button type="button" class="pn-item${S.sel === n.id ? ' on' : ''}" data-nota="${esc(n.id)}" style="align-items:flex-start"><span class="t"><span style="font-size:11px;font-weight:700;color:var(--roxo-claro)">${n.oculto ? 'Só o mestre' : 'Pública'}</span><strong style="white-space:normal;font-weight:400;font-size:13px;line-height:1.45">${esc((n.texto || '(vazia)').slice(0, 140))}</strong></span></button>`).join('');
  if (!notas.length) h = '<div class="pn-vazio">Nenhuma nota nesta cena.</div>';
  h += '<button class="pn-novo" type="button" data-acao="nota-nova">Nova nota</button>';
  return h;
}

function htmlFichas() {
  if (!S.mestre) return '';
  const naMesa = new Set([...S.itens.values()].filter((i) => i.tipo === 'boneco' && i.ficha).map((i) => i.ficha));
  const lista = [...S.fichas].sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  let h = '<div class="pn-ajuda">Os personagens do servidor. Ao pôr na mesa, o boneco acompanha a Vida da ficha e o jogador move só o dele.</div>';
  h += lista.map((f) => {
    const v = f.barras && f.barras.vida ? { atual: f.barras.vida.atual, max: f.barras.vida.max } : null;
    const nm = esc(f.nome || 'Sem nome');
    return `<div class="pn-item" style="cursor:default;flex-direction:column;align-items:stretch;gap:8px"><div class="pn-linha"><span class="pn-av" style="background:${corDe(f.id)};width:36px;height:36px;font-size:12px">${esc(sigla(f.nome))}</span><div class="t"><strong>${nm}</strong></div></div>${htmlBarra(v)}<div class="pn-botoes"><button class="bhc-btn mini${naMesa.has(f.id) ? '' : ' verm'}" type="button" data-acao="ficha-por" data-id="${esc(f.id)}" ${naMesa.has(f.id) ? 'disabled' : ''}>${naMesa.has(f.id) ? 'Na mesa' : 'Pôr na mesa'}</button>${S.db.tipo === 'local' ? '' : `<a class="bhc-btn mini" href="ficha.html?s=${encodeURIComponent(S.sessao.s)}&f=${encodeURIComponent(f.id)}&temp=1">Abrir ficha</a>`}</div></div>`;
  }).join('');
  if (!lista.length) h += '<div class="pn-vazio">Nenhuma ficha encontrada neste servidor.</div>';
  return h;
}

/* cartão no celular quando há um boneco selecionado e o painel está fechado */
function atualizarCartaoCelular() {
  const c = $('cartaoSel');
  const it = itemSel();
  const mostrar = !S.painelAberto && it && it.tipo === 'boneco' && (mestreVendo() || !it.oculto);
  c.classList.toggle('mostrar', !!mostrar);
  if (!mostrar) { c.innerHTML = ''; return; }
  const img = urlSegura(it.imagem);
  c.innerHTML = `<div class="pn-linha"><span class="pn-av" style="border-radius:12px;background-color:${esc(it.cor || '#CC0000')};color:${textoSobre(it.cor)};${img ? 'background-image:' + cssUrl(img) : ''}">${img ? '' : esc(it.sigla || sigla(it.nome))}</span><div class="t" style="flex:1"><strong>${esc(it.nome)}</strong></div></div>${htmlBarra(it.vida)}
    <div class="pn-botoes">${podeVida(it) && it.vida ? '<button class="bhc-btn" type="button" data-acao="vida-">Vida −1</button><button class="bhc-btn" type="button" data-acao="vida+">Vida +1</button>' : ''}${it.ficha && (S.mestre || it.dono === S.uid) && S.db.tipo !== 'local' ? `<a class="bhc-btn verm" href="${esc(linkFicha(it))}">Abrir ficha</a>` : ''}</div>`;
}

/* ==========================================================================
   DIÁLOGOS
   ========================================================================== */
function dialogo(html, aoMontar) {
  const f = $('dialogoFundo'), d = $('dialogo');
  d.innerHTML = html;
  f.hidden = false;
  const fechar = () => { f.hidden = true; d.innerHTML = ''; };
  f.onmousedown = (e) => { if (e.target === f) fechar(); };
  d.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', fechar));
  if (aoMontar) aoMontar(d, fechar);
  const primeiro = d.querySelector('input[type=text], input[type=url], textarea');
  if (primeiro) primeiro.focus();
  return fechar;
}

function ligarSeletorCor(d, nome, cores, atual) {
  const caixa = d.querySelector(`[data-cores="${nome}"]`);
  let valor = atual;
  caixa.innerHTML = cores.map((c) => `<button type="button" data-v="${c}" class="${c === valor ? 'on' : ''}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('');
  caixa.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    valor = b.dataset.v;
    caixa.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  return () => valor;
}

function dialogoCena(cena) {
  if (!S.mestre) return;
  const novo = !cena;
  dialogo(`
    <h2>${novo ? 'Nova cena' : 'Editar cena'}</h2>
    <label class="campo">Nome da cena<input type="text" id="fNome" maxlength="60" value="${esc(cena ? cena.nome : '')}" placeholder="Ex.: Posto de gasolina"></label>
    <label class="campo">Link da imagem do mapa<input type="url" id="fMapa" value="${esc(cena ? cena.mapa || '' : '')}" placeholder="https://..." spellcheck="false">
      <small>Cole o endereço direto da imagem (termina em .png, .jpg, .webp...). Links do próprio Discord expiram depois de um tempo: prefira Imgur, Postimages ou similar. Deixe vazio para uma cena sem mapa.</small></label>
    <div class="linha-campos">
      <label class="campo">Tamanho do mapa (%)<input type="number" id="fEscala" min="10" max="800" value="${cena ? Number(cena.escala) || 100 : 100}"></label>
      <label class="campo">Quadrado da grade (px)<input type="number" id="fGradeTam" min="10" max="400" value="${cena ? Number(cena.gradeTam) || 50 : 50}"></label>
    </div>
    <label class="marca"><input type="checkbox" id="fGrade" ${cena && cena.grade ? 'checked' : ''}> Mostrar grade (os bonecos encaixam nos quadrados)</label>
    <div class="acoes"><button class="bhc-btn" type="button" data-fechar>Cancelar</button><button class="bhc-btn verm" type="button" id="fOk">${novo ? 'Criar cena' : 'Salvar'}</button></div>
  `, (d, fechar) => {
    d.querySelector('#fOk').addEventListener('click', async () => {
      const mapa = d.querySelector('#fMapa').value.trim();
      if (mapa && !urlSegura(mapa)) { d.querySelector('#fMapa').focus(); d.querySelector('#fMapa').style.borderColor = '#ff3131'; return; }
      const dados = {
        nome: d.querySelector('#fNome').value.trim().slice(0, 60) || 'Cena',
        mapa,
        escala: clamp(Number(d.querySelector('#fEscala').value) || 100, 10, 800),
        grade: d.querySelector('#fGrade').checked,
        gradeTam: clamp(Number(d.querySelector('#fGradeTam').value) || 50, 10, 400),
      };
      fechar();
      if (novo) {
        const id = await S.db.cenas.criar({ ...dados, ordem: S.cenas.length });
        S.cenaVistaId = id;
        if (!S.cenas.some((c) => c.ativa)) await ativarCenaDepois(id, dados);
      } else {
        await S.db.cenas.atualizar(cena.id, dados);
        if (cena.ativa) await S.db.estado.salvar({ cenaNome: dados.nome, cenaMapa: urlSegura(dados.mapa) || null });
      }
      erroMapa = '';
    });
  });
}
// a primeira cena criada já vira a ativa (assim os jogadores não ficam sem nada)
async function ativarCenaDepois(id, dados) {
  await S.db.cenas.ativar(id, { cenaAtiva: id, cenaNome: dados.nome, cenaMapa: urlSegura(dados.mapa) || null });
}

function dialogoBoneco(boneco) {
  if (!S.mestre) return;
  const edit = !!boneco;
  dialogo(`
    <h2>${edit ? 'Editar boneco' : 'Novo NPC ou monstro'}</h2>
    <label class="campo">Nome<input type="text" id="fNome" maxlength="40" value="${esc(boneco ? boneco.nome : '')}" placeholder="Ex.: Sentinela"></label>
    <div class="linha-campos">
      <label class="campo">Vida máxima<input type="number" id="fVida" min="0" max="999" value="${boneco && boneco.vida ? boneco.vida.max : 10}"></label>
      <div class="campo">Tamanho<div class="seg-mini" id="fTam">${Object.keys(TAMANHOS).map((k) => `<button type="button" data-k="${k}" class="${(boneco && boneco.tam ? boneco.tam : 'M') === k ? 'on' : ''}">${k}</button>`).join('')}</div></div>
    </div>
    <div class="campo">Cor<div class="cores-sel" data-cores="cor"></div></div>
    <label class="campo">Imagem (opcional)<input type="url" id="fImg" value="${esc(boneco ? boneco.imagem || '' : '')}" placeholder="https://... (link direto da imagem)" spellcheck="false"></label>
    <div class="acoes"><button class="bhc-btn" type="button" data-fechar>Cancelar</button><button class="bhc-btn verm" type="button" id="fOk">${edit ? 'Salvar' : 'Colocar na mesa'}</button></div>
  `, (d, fechar) => {
    const cor = ligarSeletorCor(d, 'cor', CORES_BONECO, boneco ? boneco.cor : CORES_BONECO[0]);
    let tam = boneco && boneco.tam ? boneco.tam : 'M';
    d.querySelector('#fTam').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      tam = b.dataset.k;
      d.querySelectorAll('#fTam button').forEach((x) => x.classList.toggle('on', x === b));
    });
    d.querySelector('#fOk').addEventListener('click', async () => {
      const nome = d.querySelector('#fNome').value.trim().slice(0, 40) || 'NPC';
      const max = clamp(Math.round(Number(d.querySelector('#fVida').value) || 0), 0, 999);
      const imagem = urlSegura(d.querySelector('#fImg').value);
      const cena = cenaMostrada();
      fechar();
      if (edit) {
        const atual = boneco.vida ? Math.min(boneco.vida.atual, max) : max;
        if (cena) S.db.itens.salvar(cena.id, boneco.id, { nome, sigla: sigla(nome), cor: cor(), corTexto: textoSobre(cor()), tamanho: tamanhoPx(tam), tam, imagem, vida: max ? { atual, max } : null });
      } else {
        const novoId = await colocarBoneco({ nome, sigla: sigla(nome), cor: cor(), corTexto: textoSobre(cor()), tamanho: tamanhoPx(tam), tam, imagem, vida: max ? { atual: max, max } : null, ficha: '', dono: '', kind: 'npc' });
        if (novoId) selecionar(novoId);
      }
    });
  });
}

function dialogoCampanha() {
  if (!S.mestre) return;
  dialogo(`
    <h2>Campanha</h2>
    <label class="campo">Nome da campanha<input type="text" id="fNome" maxlength="60" value="${esc(S.estado.campanha || '')}" placeholder="Aparece na página inicial"></label>
    <label class="campo">Próxima sessão<input type="text" id="fProx" maxlength="60" value="${esc(S.estado.proxima || '')}" placeholder="Ex.: sábado, 20h"></label>
    <div class="acoes"><button class="bhc-btn" type="button" data-fechar>Cancelar</button><button class="bhc-btn verm" type="button" id="fOk">Salvar</button></div>
  `, (d, fechar) => {
    d.querySelector('#fOk').addEventListener('click', async () => {
      const patch = { campanha: d.querySelector('#fNome').value.trim().slice(0, 60), proxima: d.querySelector('#fProx').value.trim().slice(0, 60) };
      fechar();
      await S.db.estado.salvar(patch);
    });
  });
}

function dialogoConfirmar(titulo, texto, rotulo, aoConfirmar) {
  dialogo(`<h2>${esc(titulo)}</h2><p>${esc(texto)}</p><div class="acoes"><button class="bhc-btn" type="button" data-fechar>Cancelar</button><button class="bhc-btn perigo" type="button" id="fOk">${esc(rotulo)}</button></div>`, (d, fechar) => {
    d.querySelector('#fOk').addEventListener('click', () => { fechar(); aoConfirmar(); });
  });
}

function dialogoAjuda() {
  dialogo(`
    <h2>Como usar a mesa</h2>
    <ul>
      <li><b>Arrastar a tela</b>: segure em um lugar vazio e arraste. <b>Zoom</b>: roda do mouse ou pinça no celular.</li>
      <li><b>Bonecos</b>: arraste para mover. O jogador só move o dele; o mestre move todos.</li>
      <li><b>Nota</b>: ferramenta Nota, clique no mapa e escreva. Clique duas vezes numa nota para editar.</li>
      <li><b>Desenhar</b>: escolha cor e espessura, e desenhe com o dedo ou mouse. Para apagar, mude para Mover, clique no traço e use Apagar.</li>
      ${S.mestre ? `<li><b>Cenas</b>: cada cena tem um mapa (link) e fica preparada só para o mestre até você tocar em <b>Mostrar para todos</b>.</li>
      <li><b>Ver a mesa como Jogadores</b> mostra exatamente o que eles veem (sem os itens ocultos).</li>
      <li><b>Fichas</b>: ponha os personagens dos jogadores na mesa; a Vida do boneco acompanha a ficha.</li>` : ''}
    </ul>
    <div class="acoes"><button class="bhc-btn verm" type="button" data-fechar>Entendi</button></div>
  `);
}

/* ==========================================================================
   AÇÕES DO PAINEL (clique)
   ========================================================================== */
async function aoClicarPainel(e) {
  const alvo = e.target.closest('button, [data-cor-nota]');
  if (!alvo) return;
  const it = itemSel();
  const cena = cenaMostrada();

  if (alvo.dataset.corNota && it && cena) { S.db.itens.salvar(cena.id, it.id, { cor: alvo.dataset.corNota }); it.cor = alvo.dataset.corNota; agendar('itens'); agendar('painel'); return; }
  if (alvo.dataset.cena) { if (S.mestre) { S.cenaVistaId = alvo.dataset.cena; S.sel = null; carregarItens(); renderTudo(); } return; }
  if (alvo.dataset.boneco) { const b = S.itens.get(alvo.dataset.boneco); if (b) { selecionar(b.id); centralizarEm(Number(b.x) || 0, Number(b.y) || 0); } return; }
  if (alvo.dataset.nota) { const n = S.itens.get(alvo.dataset.nota); if (n) { selecionar(n.id); centralizarEm((Number(n.x) || 0) + 90, Number(n.y) || 0); } return; }

  const acao = alvo.dataset.acao;
  if (!acao) return;
  switch (acao) {
    case 'vida-': if (it) ajustarVida(it, -1); break;
    case 'vida+': if (it) ajustarVida(it, 1); break;
    case 'ocultar': if (it && cena) { it.oculto = !it.oculto; S.db.itens.salvar(cena.id, it.id, { oculto: it.oculto }); agendar('itens'); agendar('painel'); } break;
    case 'editar': if (it && it.tipo === 'boneco') dialogoBoneco(it); break;
    case 'escrever': if (it) abrirEdicaoNota(it.id); break;
    case 'apagar':
      if (it && cena && podeApagar(it)) {
        const id = it.id; S.itens.delete(id); S.sel = null;
        S.db.itens.apagar(cena.id, id); agendar('itens'); agendar('painel'); atualizarCartaoCelular();
      }
      break;
    case 'cena-nova': dialogoCena(null); break;
    case 'cena-editar': dialogoCena(S.cenas.find((c) => c.id === alvo.dataset.id)); break;
    case 'cena-ativar': ativarCena(alvo.dataset.id); break;
    case 'cena-apagar': {
      const c = S.cenas.find((x) => x.id === alvo.dataset.id);
      if (c) dialogoConfirmar('Apagar cena', `Apagar "${c.nome}" e tudo o que está nela (bonecos, notas e desenhos)? Não dá para desfazer.`, 'Apagar cena', async () => {
        await S.db.cenas.apagar(c.id);
        if (S.cenaVistaId === c.id) S.cenaVistaId = null;
      });
      break;
    }
    case 'boneco-novo': dialogoBoneco(); break;
    case 'nota-nova': { const c = centroDaTela(); criarNotaEm(c.x, c.y); break; }
    case 'ficha-por': {
      const f = S.fichas.find((x) => x.id === alvo.dataset.id);
      if (f) {
        const v = f.barras && f.barras.vida ? { atual: Number(f.barras.vida.atual) || 0, max: Number(f.barras.vida.max) || 0 } : null;
        const id = await colocarBoneco({ nome: f.nome || 'Personagem', sigla: sigla(f.nome), cor: corDe(f.id), corTexto: textoSobre(corDe(f.id)), tamanho: tamanhoPx('M'), tam: 'M', imagem: '', vida: v, ficha: f.id === 'local' ? '' : f.id, dono: f.dono || '', kind: 'pc' });
        if (id) selecionar(id);
      }
      break;
    }
    default: break;
  }
}

/* ==========================================================================
   CABEÇALHO E PRESENÇA
   ========================================================================== */
function renderCabecalho() {
  const c = cenaMostrada();
  $('cenaNome').textContent = c ? (c.nome || 'Cena') : 'Mesa';
  const agora = Date.now();
  const gente = S.presenca.filter((p) => agora - (p.visto || 0) < 75000);
  gente.sort((a, b) => (b.mestre ? 1 : 0) - (a.mestre ? 1 : 0) || String(a.nome).localeCompare(String(b.nome)));
  $('gente').innerHTML = gente.slice(0, 6).map((p) => `<b style="background:${esc(p.cor || corDe(p.nome))}" title="${esc(p.nome)}">${esc(p.sigla || sigla(p.nome))}</b>`).join('');
  const linha = $('statusLinha');
  if (S.db.tipo === 'local') { linha.className = ''; $('statusTxt').textContent = 'Modo de teste · só neste navegador'; }
  else if (!S.mesaOk) { linha.className = 'erro'; $('statusTxt').textContent = 'Sem acesso à mesa'; }
  else { linha.className = 'ok'; $('statusTxt').textContent = `Salvo · ${gente.length || 1} conectado${gente.length > 1 ? 's' : ''}`; }
}

function renderTudo() {
  renderCena(); renderItens(); renderPainel(); renderCabecalho(); atualizarCartaoCelular();
}

/* ==========================================================================
   LIGAÇÕES COM O BANCO
   ========================================================================== */
function carregarItens() {
  const cena = cenaMostrada();
  const id = cena ? cena.id : null;
  const chave = id + '|' + S.mestre;
  if (S.itensDe === chave) return;
  if (S.desligaItens) { S.desligaItens(); S.desligaItens = null; }
  S.itensDe = chave;
  S.itens = new Map();
  els.forEach((el) => el.remove()); els.clear();
  if (!id) { agendar('itens'); agendar('painel'); return; }
  S.desligaItens = S.db.itens.ouvir(id, { ocultos: S.mestre }, (lista) => {
    const novo = new Map();
    lista.forEach((i) => novo.set(i.id, i));
    S.itens = novo;
    if (S.sel && !novo.has(S.sel)) S.sel = null;
    agendar('itens');
    if (!(gesto && gesto.tipo === 'item')) { agendar('painel'); atualizarCartaoCelular(); }
    espelharVida(); observarFichasProprias();
  });
}

function ligarBanco() {
  S.db.estado.ouvir((e) => { S.estado = e || {}; agendar('painel'); agendar('cabeca'); });
  S.db.cenas.ouvir((lista) => {
    S.cenas = lista;
    if (S.cenaVistaId && !lista.some((c) => c.id === S.cenaVistaId)) S.cenaVistaId = null;
    if (!S.cenaVistaId && S.mestre) { const a = lista.find((c) => c.ativa); S.cenaVistaId = a ? a.id : (lista[0] ? lista[0].id : null); }
    carregarItens();
    renderTudo();
  });
  S.db.presenca.ouvir((l) => { S.presenca = l; agendar('cabeca'); });
  if (S.mestre) {
    S.desligaFichas = S.db.fichas.ouvirTodas((l) => { S.fichas = l; espelharVida(); agendar('painel'); });
  }
}

function baterPresenca() {
  if (!S.mesaOk) return;
  S.db.presenca.bater({ nome: S.nome || 'Jogador', sigla: sigla(S.nome || 'Jogador'), cor: S.mestre ? '#CC7A00' : corDe(S.uid), mestre: S.mestre });
}

/* ==========================================================================
   INÍCIO
   ========================================================================== */
async function iniciar() {
  // 1) escolhe o banco: Firebase (link da Artemis) ou modo de teste
  let sessao = null;
  try { sessao = await abrirSessao(); } catch (e) { console.error(e); sessao = { erro: 'Não consegui conectar à Artemis. Recarregue a página.' }; }

  if (sessao && sessao.erro) {
    S.db = criarLocal(); S.mesaOk = false; S.mestre = false;
    $('statusLinha').className = 'erro'; $('statusTxt').textContent = sessao.erro;
  } else if (sessao) {
    S.sessao = sessao; S.db = criarFirebase(sessao);
    S.uid = sessao.uid; S.mestre = sessao.mestre; S.mesaOk = sessao.mesa;
    const resumo = ler('bhcResumo_v1') || {};
    S.nome = sessao.nome || resumo.nome || (sessao.mestre ? 'Mestre' : 'Jogador');
  } else {
    S.db = criarLocal(); S.uid = 'local'; S.mestre = true; S.mesaOk = true;
    const resumo = ler('bhcResumo_v1') || {};
    S.nome = resumo.nome || 'Você';
    $('btnLimparLocal').hidden = false;
  }
  if (!S.mesaOk) { S.mestre = false; }

  // 2) liga a tela
  montarTela();
  if (!S.mesaOk) { renderTudo(); avisos(); return; }
  ligarBanco();
  baterPresenca();
  setInterval(baterPresenca, 30000);
  setInterval(() => agendar('cabeca'), 20000);
  registrarEntrada();
  if (location.hash === '#fichas' && S.mestre) { S.aba = 'fichas'; abrirPainel(true); renderPainel(); }
  $('gavetaFim').textContent = S.db.tipo === 'local'
    ? 'Modo de teste: tudo fica só neste navegador. Para jogar com o grupo, abra o link do comando /mesa no Discord.'
    : 'Conectado à Artemis. As mudanças aparecem para todo mundo na hora.';
}

function registrarEntrada() {
  if (S.db.tipo === 'local') return;
  try {
    const k = 'bhcMesaEntrou';
    const ult = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - ult < 10 * 60 * 1000) return;
    sessionStorage.setItem(k, String(Date.now()));
  } catch (e) { /* sem sessionStorage: registra mesmo assim */ }
  S.db.atividade.registrar(`${S.nome || 'Alguém'} entrou na mesa`);
}

function montarTela() {
  // ferramentas
  document.querySelectorAll('#ferr [data-tool]').forEach((b) => b.addEventListener('click', () => definirFerramenta(b.dataset.tool)));
  $('btnPainel').addEventListener('click', () => abrirPainel(!S.painelAberto));
  $('btnFecharPainel').addEventListener('click', () => abrirPainel(false));
  document.querySelectorAll('[data-so-mestre]').forEach((b) => { b.hidden = !S.mestre; });
  $('blocoVer').hidden = !S.mestre;

  // abas e visão
  $('abas').addEventListener('click', (e) => { const b = e.target.closest('[data-aba]'); if (b) { S.aba = b.dataset.aba; renderPainel(); } });
  $('segVer').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ver]'); if (!b) return;
    S.ver = b.dataset.ver; S.sel = null; carregarItens(); renderTudo();
  });
  $('painel').addEventListener('click', aoClicarPainel);
  $('cartaoSel').addEventListener('click', aoClicarPainel);

  // zoom
  $('zMais').addEventListener('click', () => { const r = tela().getBoundingClientRect(); zoomEm(r.left + r.width / 2, r.top + r.height / 2, S.vp.z * 1.25); });
  $('zMenos').addEventListener('click', () => { const r = tela().getBoundingClientRect(); zoomEm(r.left + r.width / 2, r.top + r.height / 2, S.vp.z / 1.25); });
  $('zAjustar').addEventListener('click', ajustar);

  // desenho
  const cores = $('coresDesenho');
  cores.innerHTML = CORES_DESENHO.map((c) => `<button type="button" data-v="${c}" style="background:${c}" class="${c === S.desenho.cor ? 'on' : ''}" aria-label="Cor ${c}"></button>`).join('');
  cores.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; S.desenho.cor = b.dataset.v; cores.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('espessura').addEventListener('input', (e) => { S.desenho.larg = Number(e.target.value) || 4; });

  // tela
  const t = tela();
  t.addEventListener('pointerdown', aoApertar);
  t.addEventListener('pointermove', aoMover);
  t.addEventListener('pointerup', aoSoltar);
  t.addEventListener('pointercancel', aoSoltar);
  t.addEventListener('wheel', aoRodar, { passive: false });
  t.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.nt'); if (el) abrirEdicaoNota(el.dataset.id);
  });
  window.addEventListener('resize', () => { if (!S.mapa.ok) ajustar(); });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') { selecionar(null); definirFerramenta('sel'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && itemSel() && podeApagar(itemSel())) {
      const it = itemSel(); const c = cenaMostrada();
      if (c) { S.itens.delete(it.id); S.sel = null; S.db.itens.apagar(c.id, it.id); agendar('itens'); agendar('painel'); atualizarCartaoCelular(); }
    } else if (e.key === 'v') definirFerramenta('sel');
    else if (e.key === 'h') definirFerramenta('mov');
    else if (e.key === 'n') definirFerramenta('note');
    else if (e.key === 'd') definirFerramenta('draw');
  });

  // menu
  const g = $('gaveta'), f = $('gavetaFundo');
  const abrirG = (v) => { g.hidden = !v; f.hidden = !v; };
  $('btnMenu').addEventListener('click', () => abrirG(g.hidden));
  f.addEventListener('click', () => abrirG(false));
  $('btnAjuda').addEventListener('click', () => { abrirG(false); dialogoAjuda(); });
  $('btnCampanha').hidden = !S.mestre || S.db.tipo === 'local';
  $('btnCampanha').addEventListener('click', () => { abrirG(false); dialogoCampanha(); });
  $('btnLimparLocal').addEventListener('click', () => {
    abrirG(false);
    dialogoConfirmar('Apagar a mesa de teste', 'Isso apaga cenas, bonecos, notas e desenhos do modo de teste deste navegador.', 'Apagar tudo', () => { try { localStorage.removeItem('bhcMesaLocal_v1'); } catch (e2) { /* tanto faz */ } location.reload(); });
  });

  definirFerramenta('sel');
  aplicarVp();
}

iniciar().catch((e) => { console.error(e); $('statusLinha').className = 'erro'; $('statusTxt').textContent = 'Algo deu errado. Recarregue a página.'; });

// ajuda para quem abre o console: nada aqui é segredo, só facilita testar
window.MesaBHC = { S, ativarCena, ajustar };
