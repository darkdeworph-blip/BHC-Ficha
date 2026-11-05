/* ==========================================================================
   INTEGRAÇÃO COM A ARTEMIS (bot do Discord) — via Firebase
   --------------------------------------------------------------------------
   Como chega aqui: no Discord, o jogador usa /ficha link e recebe um link
   tipo  ...BHC-Ficha/?s=SERVIDOR&f=FICHA#t=TOKEN
   - O TOKEN faz o login (vale 1 hora; depois o navegador continua logado).
   - s e f dizem qual ficha abrir. Ficam salvos no navegador, então nas
     próximas vezes basta abrir o site normalmente.

   O que sincroniza com o bot: nome, Atributos, Habilidades, Outras
   características (as 7 linhas), Vida/Sanidade/Força de Vontade e o retrato.
   O resto (inventário, armas, anotações, Defesa...) fica guardado no campo
   "site" da ficha, que o bot não mexe.

   Sem Firebase configurado (firebase-config.js) ou sem link, nada disto roda
   e a ficha continua salvando só no navegador, como antes.
   ========================================================================== */

// O Firebase só é baixado quando a ficha está conectada (ver iniciar())
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
let fb = {};

const CHAVE_VINCULO = 'artemis_vinculo';
const LINHAS_OUTRAS = 7;

/* Chaves que o BOT usa, na MESMA ORDEM das listas ATTRIBUTES e SKILLS do script.js.
   A ligação é pela posição: se um nome for escrito diferente no site e no bot,
   continua sincronizando. Se mudar um nome no bot (ficha.py), mude a chave aqui também. */
const BOT_ATRIBUTOS = [
  'forca', 'destreza', 'vigor',
  'carisma', 'manipulacao', 'aparencia',
  'percepcao', 'inteligencia', 'raciocinio',
];
const BOT_HABILIDADES = [
  'alerta', 'arte', 'atletismo', 'consciencia', 'luta', 'empatia', 'expressao', 'intimidacao', 'instrucao', 'manha', 'labia',
  'artesanato', 'conducao', 'etiqueta', 'armasdefogo', 'artesmarciais', 'meditacao', 'armasbrancas', 'pesquisa', 'furtividade', 'sobrevivencia', 'tecnologia',
  'academicos', 'computacao', 'cosmologia', 'enigmas', 'esoterismo', 'investigacao', 'direito', 'medicina', 'ocultismo', 'politica', 'ciencia',
];
// barra do site -> barra do bot
const BARRAS = { vida: 'vida', sanidade: 'sanidade', forca: 'vontade' };

const ficha = window.FichaBHC;
const elStatus = document.getElementById('artemisStatus');
const btnReset = document.getElementById('btnReset');

/* ---------- utilidades ---------- */

function status(texto, tipo) {
  if (!elStatus) return;
  elStatus.textContent = texto || '';
  elStatus.className = 'artemis-status' + (tipo ? ' ' + tipo : '');
}

/** Mesma regra do bot: "Armas de fogo" -> "armasdefogo". */
function chave(texto) {
  return String(texto).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Compara dois objetos ignorando a ordem das chaves. */
function estavel(v) {
  if (Array.isArray(v)) return '[' + v.map(estavel).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + estavel(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
const igual = (a, b) => estavel(a) === estavel(b);

function lerArmazenado(chaveLocal) {
  try { return JSON.parse(localStorage.getItem(chaveLocal) || 'null'); } catch (e) { return null; }
}
function gravarArmazenado(chaveLocal, valor) {
  try {
    if (valor === null) localStorage.removeItem(chaveLocal);
    else localStorage.setItem(chaveLocal, JSON.stringify(valor));
  } catch (e) { /* navegador sem armazenamento: segue sem lembrar */ }
}

/** Liga cada traço do site (chave dos pontos) à chave do bot. */
function mapaDeTracos() {
  const atributos = [];
  Object.entries(ficha.ATTRIBUTES).forEach(([coluna, itens]) => itens.forEach((item) => {
    atributos.push(`attr-${ficha.slug(coluna)}-${ficha.slug(item)}-dots`);
  }));
  const habilidades = [];
  Object.entries(ficha.SKILLS).forEach(([coluna, itens]) => itens.forEach((item) => {
    habilidades.push(`skill-${ficha.slug(coluna)}-${ficha.slug(item)}-dots`);
  }));
  return {
    atributos: atributos.map((site, i) => [site, BOT_ATRIBUTOS[i]]),
    habilidades: habilidades.map((site, i) => [site, BOT_HABILIDADES[i]]),
  };
}
const MAPA = mapaDeTracos();

/** Outras características na ordem das linhas do site. */
function extrasEmOrdem(dados) {
  return Object.entries(dados.extras || {})
    .map(([k, e]) => ({ k, ...e }))
    .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || String(a.nome).localeCompare(String(b.nome)));
}

const pontos = (texto) => Math.max(0, parseInt(texto, 10) || 0);

/* ---------- Firebase -> tela ---------- */

function aplicarNaTela(dados) {
  const estado = JSON.parse(JSON.stringify(dados.site || {}));
  estado.fields = estado.fields || {};
  estado.dots = estado.dots || {};
  estado.checks = estado.checks || {};
  estado.bars = estado.bars || {};
  estado.portraits = {};

  // O que vem do bot manda (o site mostra no máximo 5 bolinhas)
  MAPA.atributos.forEach(([site, bot]) => { estado.dots[site] = String(Math.min(5, dados.atributos?.[bot] ?? 0)); });
  MAPA.habilidades.forEach(([site, bot]) => { estado.dots[site] = String(Math.min(5, dados.habilidades?.[bot] ?? 0)); });

  const extras = extrasEmOrdem(dados);
  for (let i = 0; i < LINHAS_OUTRAS; i++) {
    estado.fields[`outras-${i}-texto`] = extras[i] ? extras[i].nome : '';
    estado.dots[`outras-${i}-dots`] = String(extras[i] ? Math.min(5, extras[i].valor) : 0);
  }

  Object.entries(BARRAS).forEach(([site, bot]) => {
    const b = dados.barras?.[bot];
    if (b) estado.bars[site] = { cur: String(b.atual), max: String(b.max) };
  });

  estado.fields['nome-personagem'] = dados.nome || '';
  if (dados.retrato) estado.portraits['portraitImg-main'] = dados.retrato;
  if (dados.retrato_corpo) estado.portraits['portraitImg-full'] = dados.retrato_corpo;

  // Não atropela o campo que a pessoa está digitando agora
  const ativo = document.activeElement;
  const chaveAtiva = ativo && ativo.dataset ? ativo.dataset.key : null;
  const valorAtivo = chaveAtiva ? ('value' in ativo ? ativo.value : ativo.textContent) : null;

  ficha.limparFicha();
  ficha.applyState(estado);

  if (chaveAtiva && document.activeElement === ativo) {
    if ('value' in ativo) ativo.value = valorAtivo; else ativo.textContent = valorAtivo;
  }
}

/* ---------- tela -> Firebase ---------- */

function montarMudancas(estado, ultimo) {
  const mudancas = {};

  const site = JSON.parse(JSON.stringify(estado));
  delete site.portraits;
  if (!igual(site, ultimo.site || {})) mudancas.site = site;

  // Atributos e Habilidades: se a bolinha mostrada é a mesma de antes, mantém o
  // valor do bot (que pode passar de 5); só grava o que a pessoa mudou.
  [['atributos', MAPA.atributos], ['habilidades', MAPA.habilidades]].forEach(([secao, mapa]) => {
    const novo = { ...(ultimo[secao] || {}) };
    mapa.forEach(([siteKey, botKey]) => {
      const naTela = pontos(estado.dots[siteKey]);
      const antes = novo[botKey] ?? 0;
      if (naTela !== Math.min(5, antes)) novo[botKey] = naTela;
    });
    if (!igual(novo, ultimo[secao] || {})) mudancas[secao] = novo;
  });

  const extras = {};
  for (let i = 0; i < LINHAS_OUTRAS; i++) {
    const nome = (estado.fields[`outras-${i}-texto`] || '').trim();
    const k = chave(nome);
    if (!k) continue;
    const naTela = pontos(estado.dots[`outras-${i}-dots`]);
    const antes = (ultimo.extras || {})[k];
    const valor = antes && naTela === Math.min(5, antes.valor) ? antes.valor : naTela;
    extras[k] = { ...(antes || {}), nome: nome.slice(0, 40), valor, ordem: i };
  }
  // As que não cabem nas 7 linhas continuam como estão
  extrasEmOrdem(ultimo).slice(LINHAS_OUTRAS).forEach((e) => {
    if (!(e.k in extras)) { const { k, ...resto } = e; extras[k] = resto; }
  });
  if (!igual(extras, ultimo.extras || {})) mudancas.extras = extras;

  const barras = JSON.parse(JSON.stringify(ultimo.barras || {}));
  Object.entries(BARRAS).forEach(([siteKey, botKey]) => {
    const b = estado.bars[siteKey];
    if (b) barras[botKey] = { atual: pontos(b.cur), max: pontos(b.max) };
  });
  if (!igual(barras, ultimo.barras || {})) mudancas.barras = barras;

  const nome = (estado.fields['nome-personagem'] || '').trim().slice(0, 60);
  if (nome && nome !== ultimo.nome) mudancas.nome = nome;

  const retrato = estado.portraits['portraitImg-main'] || null;
  if (retrato !== (ultimo.retrato || null)) mudancas.retrato = retrato;
  const corpo = estado.portraits['portraitImg-full'] || null;
  if (corpo !== (ultimo.retrato_corpo || null)) mudancas.retrato_corpo = corpo;

  if (Object.keys(mudancas).length) mudancas.atualizado_em = new Date().toISOString();
  return mudancas;
}

/* ---------- conexão ---------- */

const ArtemisOnline = {
  ativo: false,
  ultimo: null,
  ref: null,
  auth: null,
  _espera: null,
  _pendente: null,

  salvar(estado) {
    if (!this.ativo || !this.ultimo) return;
    this._pendente = estado;
    clearTimeout(this._espera);
    this._espera = setTimeout(() => this._enviar(), 400);
  },

  async _enviar() {
    const estado = this._pendente;
    this._pendente = null;
    if (!estado) return;
    const mudancas = montarMudancas(estado, this.ultimo);
    if (!Object.keys(mudancas).length) return;
    Object.assign(this.ultimo, mudancas); // já conta como o estado mais novo
    try {
      await fb.updateDoc(this.ref, mudancas);
    } catch (erro) {
      console.error(erro);
      status('Não consegui salvar no Discord. Confira a internet e recarregue a página.', 'erro');
    }
  },

  async desconectar() {
    gravarArmazenado(CHAVE_VINCULO, null);
    try { if (this.auth) await fb.signOut(this.auth); } catch (e) { /* tanto faz */ }
    location.href = location.pathname;
  },
};
window.ArtemisOnline = ArtemisOnline;

function voltarAoModoLocal(mensagem) {
  ArtemisOnline.ativo = false;
  window.ARTEMIS_ONLINE = false;
  if (btnReset) btnReset.textContent = 'Limpar ficha';
  ficha.limparFicha();
  ficha.applyState(ficha.loadState());
  status(mensagem, 'erro');
}

async function iniciar() {
  const consulta = new URLSearchParams(location.search);
  const fragmento = new URLSearchParams(location.hash.slice(1));
  const token = fragmento.get('t');
  if (consulta.get('s') && consulta.get('f')) {
    gravarArmazenado(CHAVE_VINCULO, { s: consulta.get('s'), f: consulta.get('f') });
  }
  // Tira o token e os códigos da barra de endereço (não ficam no histórico nem em print)
  if (token || consulta.has('f')) history.replaceState(null, '', location.pathname);

  const vinculo = lerArmazenado(CHAVE_VINCULO);
  if (!vinculo) return voltarAoModoLocal('');

  status('Conectando à Artemis...');
  const modulos = await Promise.all([
    import(FIREBASE_SDK + 'firebase-app.js'),
    import(FIREBASE_SDK + 'firebase-auth.js'),
    import(FIREBASE_SDK + 'firebase-firestore.js'),
  ]);
  fb = Object.assign({}, ...modulos);
  const app = fb.initializeApp(window.FIREBASE_CONFIG);
  const auth = fb.getAuth(app);
  const db = fb.getFirestore(app);
  ArtemisOnline.auth = auth;

  if (token) {
    try {
      await fb.signInWithCustomToken(auth, token);
    } catch (erro) {
      console.error(erro);
      return voltarAoModoLocal('Esse link expirou ou é inválido. Peça um novo com /ficha link no Discord.');
    }
  }
  await auth.authStateReady();
  if (!auth.currentUser) {
    return voltarAoModoLocal('Sessão expirada. Peça um link novo com /ficha link no Discord.');
  }

  ArtemisOnline.ref = fb.doc(db, 'servidores', vinculo.s, 'personagens', vinculo.f);
  fb.onSnapshot(ArtemisOnline.ref, (foto) => {
    if (!foto.exists()) {
      gravarArmazenado(CHAVE_VINCULO, null);
      return voltarAoModoLocal('Essa ficha não existe mais no Discord.');
    }
    if (foto.metadata.hasPendingWrites) return; // é a nossa própria gravação voltando
    ArtemisOnline.ultimo = foto.data();
    ArtemisOnline.ativo = true;
    aplicarNaTela(ArtemisOnline.ultimo);
    if (btnReset) btnReset.textContent = 'Desconectar';
    status(`Conectado à Artemis · ${ArtemisOnline.ultimo.nome}`, 'ok');
  }, (erro) => {
    console.error(erro);
    gravarArmazenado(CHAVE_VINCULO, null);
    voltarAoModoLocal('Sem acesso a essa ficha. Peça um link novo com /ficha link no Discord.');
  });
}

if (window.ARTEMIS_ONLINE && ficha) {
  iniciar().catch((erro) => {
    console.error(erro);
    voltarAoModoLocal('Não consegui conectar à Artemis. Recarregue a página.');
  });
}
