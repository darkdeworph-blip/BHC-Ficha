/* ==========================================================================
   FICHA UNIVERSAL — BLACK HOLE CLUB
   Lógica de montagem da ficha, interatividade e persistência (localStorage).
   Organizado em: 1) Dados  2) Utilitários  3) Construção do DOM
   4) Interatividade  5) Persistência  6) Inicialização
   ========================================================================== */

/* ==========================================================================
   1) DADOS — listas usadas para montar as linhas repetidas da ficha.
   Textos mantidos EXATAMENTE como na ficha original (inclusive grafias).
   ========================================================================== */

const SAUDE_STATES = [
  ['ileso', 'Ileso', '-'],
  ['machucado', 'Machucado', '0'],
  ['ferido', 'Ferido', '-1'],
  ['gravemente-ferido', 'Gravemente ferido', '-1'],
  ['multilado', 'Multilado', '-2'],
  ['incapaz', 'Incapaz', '-3'],
  ['imcapacitado', 'Imcapacitado', '-5'],
];

const SANIDADE_STATES = [
  ['lucido', 'Lúcido', '-'],
  ['inquieto', 'Inquieto', '0'],
  ['abalado', 'Abalado', '-1'],
  ['pertubado', 'Pertubado', '-1'],
  ['instavel', 'Instavel', '-2'],
  ['insano', 'Insano', '-3'],
  ['colapso-mental', 'Colapso mental', '-5'],
];

const ATTRIBUTES = {
  'Fisicos': ['Força', 'Destreza', 'Vigor'],
  'Sociais': ['Carisma', 'Manipulação', 'Aparencia'],
  'Mentais': ['Percepção', 'Inteligencia', 'Raciocionio'],
};

const SKILLS = {
  'Talentos': ['Alerta', 'Arte', 'Atletismo', 'Consciencia', 'Luta', 'Empatia', 'Expressão', 'Intimidação', 'Instrução', 'Manha', 'Lábia'],
  'Pericias': ['Artesanato', 'Condução', 'Etiqueta', 'Armas de fogo', 'Arter marciais', 'Meditação', 'Armas Branca', 'Pesquisa', 'Furtividade', 'Sobrevivencia', 'Tecnologia'],
  'Conhecimentos': ['Academicos', 'Computação', 'Cosmologia', 'Enigmas', 'Esoterismo', 'Investigação', 'Direito', 'Medicina', 'Ocultismo', 'Politica', 'Ciência'],
};

const DESCRIPTION_FIELDS = ['Idade', 'Data de Nascimento', 'Cabelo', 'Olhos', 'Etnia', 'Nacionalidade', 'Altura', 'Peso', 'Sexo'];
const WEAPON_LABELS = ['Arma', 'Tipo', 'Dano', 'Descrição'];
const ARMOR_LABELS = ['Tipo', 'Proteção', 'Penalidade', 'Descrição'];

const STATE_KEY = 'bhcFichaUniversal_v1';

/* ==========================================================================
   2) UTILITÁRIOS
   ========================================================================== */

/** Converte um rótulo em uma chave estável, sem acentos/espaços. */
function slug(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Escapa uma chave para uso seguro em seletor [data-key="..."]. */
function keySelector(key) {
  if (window.CSS && CSS.escape) return `[data-key="${CSS.escape(key)}"]`;
  return `[data-key="${key.replace(/"/g, '\\"')}"]`;
}

/* ==========================================================================
   3) CONSTRUÇÃO DO DOM — gera as seções repetitivas a partir dos dados acima.
   ========================================================================== */

/** Cria o widget de pontos (5 círculos clicáveis) usado em toda a ficha. */
function createDots(key, max = 5) {
  const wrap = document.createElement('div');
  wrap.className = 'dots';
  wrap.dataset.key = key;
  wrap.dataset.value = '0';

  for (let i = 0; i < max; i++) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'dot';
    dot.dataset.index = String(i);
    dot.setAttribute('aria-label', `Nível ${i + 1}`);
    wrap.appendChild(dot);
  }

  wrap.addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    const clicked = parseInt(dot.dataset.index, 10) + 1;
    const current = parseInt(wrap.dataset.value, 10) || 0;
    // Clicar no último ponto preenchido esvazia aquele ponto; caso
    // contrário, preenche até o ponto clicado.
    setDotsValue(wrap, current === clicked ? clicked - 1 : clicked);
    saveState();
  });

  return wrap;
}

function setDotsValue(wrap, value) {
  wrap.dataset.value = String(value);
  [...wrap.children].forEach((dot, i) => dot.classList.toggle('filled', i < value));
}

/** Monta as linhas de Saúde ou Sanidade (rótulo + modificador + caixa). */
function buildStatusRows(container, states, group) {
  states.forEach(([key, label, mod], i) => {
    const row = document.createElement('div');
    row.className = 'status-row' + (i % 2 === 1 ? ' stripe' : '');
    row.dataset.key = `status-${group}-${key}`;
    row.dataset.group = group;

    const labelEl = document.createElement('span');
    labelEl.className = 'status-label';
    labelEl.textContent = label;

    const modEl = document.createElement('span');
    modEl.className = 'status-mod';
    modEl.textContent = mod;

    const checkEl = document.createElement('span');
    checkEl.className = 'status-check';

    row.append(labelEl, modEl, checkEl);

    row.addEventListener('click', () => {
      const wasChecked = row.classList.contains('checked');
      container.querySelectorAll('.status-row').forEach((r) => r.classList.remove('checked'));
      if (!wasChecked) row.classList.add('checked');
      saveState();
    });

    container.appendChild(row);
  });
}

/** Monta uma linha de atributo/habilidade: rótulo editável + linha + pontos. */
function buildTraitRow(label, key, role) {
  const row = document.createElement('div');
  row.className = 'trait-row';
  row.dataset.role = role; // 'attribute' ou 'skill' — usado pela rolagem de dados
  row.dataset.rollKey = key;

  const labelEl = document.createElement('span');
  labelEl.className = 'trait-label';
  labelEl.contentEditable = 'true';
  labelEl.dataset.key = `${key}-label`;
  labelEl.textContent = label;
  // Um clique simples só seleciona a linha; edição do nome exige duplo clique.
  labelEl.addEventListener('mousedown', (e) => e.preventDefault());
  labelEl.addEventListener('dblclick', () => labelEl.focus());

  const fill = document.createElement('span');
  fill.className = 'trait-fill';

  const dots = createDots(`${key}-dots`);

  row.append(labelEl, fill, dots);

  // Clique na linha (exceto nos pontos, que têm seu próprio clique) seleciona para rolagem.
  row.addEventListener('click', (e) => {
    if (e.target.closest('.dots')) return; // clique nos pontos só ajusta o valor
    selectTraitRow(row);
  });

  return row;
}

function buildAttributesGrid() {
  const grid = document.getElementById('attributesGrid');
  Object.entries(ATTRIBUTES).forEach(([colName, items]) => {
    const col = document.createElement('div');
    col.className = 'attr-column';

    const heading = document.createElement('h3');
    heading.className = 'attr-column-heading';
    heading.textContent = colName;
    col.appendChild(heading);

    items.forEach((item) => {
      col.appendChild(buildTraitRow(item, `attr-${slug(colName)}-${slug(item)}`, 'attribute'));
    });

    grid.appendChild(col);
  });
}

function buildSkillsGrid() {
  const grid = document.getElementById('skillsGrid');
  Object.entries(SKILLS).forEach(([colName, items]) => {
    const col = document.createElement('div');
    col.className = 'skill-column';

    const heading = document.createElement('h3');
    heading.className = 'skill-column-heading';
    heading.textContent = colName;
    col.appendChild(heading);

    items.forEach((item) => {
      col.appendChild(buildTraitRow(item, `skill-${slug(colName)}-${slug(item)}`, 'skill'));
    });

    grid.appendChild(col);
  });
}

/** Monta linhas em branco (Outras características / Antecedentes). */
function buildBlankRows(containerId, count, keyPrefix) {
  const container = document.getElementById(containerId);
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'blank-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.key = `${keyPrefix}-${i}-texto`;

    row.append(input, createDots(`${keyPrefix}-${i}-dots`));
    container.appendChild(row);
  }
}

/** Monta as 7 linhas da tabela de Inventário. */
function buildInventory() {
  const body = document.getElementById('inventoryBody');
  const cols = ['item', 'categoria', 'qtd', 'tamanho', 'obs'];
  for (let r = 0; r < 7; r++) {
    const tr = document.createElement('tr');
    cols.forEach((c) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.key = `inventario-${r}-${c}`;
      td.appendChild(input);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

/** Monta as linhas de Qualidades ou Defeitos (nome + tipo + custo). */
function buildQDRows(containerId, keyPrefix, count) {
  const container = document.getElementById(containerId);
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'qd-row';

    const nome = document.createElement('input');
    nome.type = 'text';
    nome.className = 'qd-nome';
    nome.dataset.key = `${keyPrefix}-${i}-nome`;

    const tipo = document.createElement('input');
    tipo.type = 'text';
    tipo.dataset.key = `${keyPrefix}-${i}-tipo`;

    const custo = document.createElement('input');
    custo.type = 'text';
    custo.dataset.key = `${keyPrefix}-${i}-custo`;

    row.append(nome, tipo, custo);
    container.appendChild(row);
  }
}

/** Monta um bloco de campos rotulados (usado em Armamento/Armadura/Description). */
function buildLabeledField(label, key, extraClass) {
  const field = document.createElement('div');
  field.className = extraClass || 'weapon-field';

  const lbl = document.createElement('span');
  lbl.className = 'wf-label';
  lbl.textContent = label + ':';

  const input = document.createElement('input');
  input.type = 'text';
  input.dataset.key = key;

  field.append(lbl, input);
  return field;
}

/** Monta um bloco de arma (Arma/Tipo/Dano/Descrição + 2 linhas extra). */
function buildWeaponBlock(index) {
  const block = document.createElement('div');
  block.className = 'weapon-block';

  WEAPON_LABELS.forEach((label) => {
    block.appendChild(buildLabeledField(label, `arma-${index}-${slug(label)}`));
  });

  for (let e = 0; e < 2; e++) {
    const extra = document.createElement('input');
    extra.type = 'text';
    extra.className = 'weapon-extra-line';
    extra.dataset.key = `arma-${index}-extra-${e}`;
    block.appendChild(extra);
  }

  return block;
}

/**
 * Monta a grade compartilhada de Armamento + Armadura: 3 blocos de arma e,
 * na 4ª célula (ao lado do 3º bloco de arma), o bloco de Armadura — exatamente
 * como alinhado no documento original.
 */
function buildWeaponsAndArmor() {
  const grid = document.getElementById('weaponsGrid');

  for (let w = 0; w < 3; w++) {
    grid.appendChild(buildWeaponBlock(w));
  }

  const armorBlock = document.createElement('div');
  armorBlock.className = 'armor-block';

  const heading = document.createElement('h3');
  heading.className = 'subsection-title-serif armadura-heading';
  heading.textContent = 'Armadura';
  armorBlock.appendChild(heading);

  ARMOR_LABELS.forEach((label) => {
    armorBlock.appendChild(buildLabeledField(label, `armadura-${slug(label)}`));
  });

  grid.appendChild(armorBlock);
}

function buildDescription() {
  const container = document.getElementById('descriptionFields');
  DESCRIPTION_FIELDS.forEach((label) => {
    container.appendChild(buildLabeledField(label, `desc-${slug(label)}`, 'desc-field'));
  });
}

/** Ajusta a largura do preenchimento visual da barra conforme atual/máximo.
 *  Também sincroniza as barras espelho de Vida/Sanidade ao lado do retrato. */
function updateBarFill(group) {
  const cur = parseInt(group.querySelector('.bar-current').textContent, 10) || 0;
  const max = parseInt(group.querySelector('.bar-max').textContent, 10) || 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  group.querySelector('.bar-fill').style.width = pct + '%';

  const bar = group.dataset.bar;
  const mirror = document.querySelector(`.flag-stat-${bar} .flag-stat-fill`);
  if (mirror) mirror.style.width = pct + '%';
}

/** Aplica os valores padrão do modelo original (antes de carregar dados salvos). */
function setDefaults() {
  const barDefaults = { vida: ['0', '30'], sanidade: ['0', '30'], forca: ['0', '10'] };
  Object.entries(barDefaults).forEach(([bar, [cur, max]]) => {
    const group = document.querySelector(`.bar-group[data-bar="${bar}"]`);
    group.querySelector('.bar-current').textContent = cur;
    group.querySelector('.bar-max').textContent = max;
    updateBarFill(group);
  });
  document.querySelector('.defesa-value').textContent = '16';
  document.querySelector('.deslocamento-box').textContent = '18m/12q';
}

/* ==========================================================================
   4) INTERATIVIDADE
   ========================================================================== */

function wireBarArrows() {
  document.querySelectorAll('.bar-arrow').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.bar-group');
      const curEl = group.querySelector('.bar-current');
      const max = parseInt(group.querySelector('.bar-max').textContent, 10) || 0;
      let cur = parseInt(curEl.textContent, 10) || 0;
      const dir = btn.classList.contains('bar-arrow-right') ? 1 : -1;
      cur = Math.max(0, Math.min(max, cur + dir));
      curEl.textContent = String(cur);
      updateBarFill(group);
      saveState();
    });
  });
}

/** Mantém os campos numéricos editáveis (vida/sanidade/força/defesa) só com dígitos. */
function wireEditableNumberFields() {
  document.querySelectorAll('.bar-current, .bar-max, .defesa-value').forEach((el) => {
    el.addEventListener('input', () => {
      const clean = el.textContent.replace(/[^\d]/g, '');
      if (clean !== el.textContent) el.textContent = clean;
      if (el.classList.contains('bar-current') || el.classList.contains('bar-max')) {
        updateBarFill(el.closest('.bar-group'));
      }
    });
    el.addEventListener('blur', () => {
      if (el.textContent.trim() === '') el.textContent = '0';
      if (el.classList.contains('bar-current') || el.classList.contains('bar-max')) {
        const group = el.closest('.bar-group');
        const curEl = group.querySelector('.bar-current');
        const maxEl = group.querySelector('.bar-max');
        const max = parseInt(maxEl.textContent, 10) || 0;
        const cur = parseInt(curEl.textContent, 10) || 0;
        if (cur > max) curEl.textContent = String(max);
        updateBarFill(group);
      }
    });
  });
}

/** Impede quebra de linha ao pressionar Enter em campos de uma linha só. */
function wireEnterBlurs() {
  document.addEventListener('keydown', (e) => {
    const isSingleLineField = e.target.matches('input[type="text"], [contenteditable="true"]');
    if (e.key === 'Enter' && isSingleLineField) {
      e.preventDefault();
      e.target.blur();
    }
  });
}

/** Redimensiona uma imagem para um tamanho máximo e converte para JPEG,
 *  evitando estourar o limite do LocalStorage com fotos grandes de celular. */
function resizeImageToDataUrl(imgEl, maxSize) {
  let { naturalWidth: width, naturalHeight: height } = imgEl;
  if (width > height && width > maxSize) {
    height = Math.round(height * (maxSize / width));
    width = maxSize;
  } else if (height >= width && height > maxSize) {
    width = Math.round(width * (maxSize / height));
    height = maxSize;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(imgEl, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Envio de retrato (upload de imagem) com ajuste automático via object-fit/cover. */
function setupPortraitUpload(btnId, inputId, imgId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  const img = document.getElementById(imgId);

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const tempImg = new Image();
      tempImg.onload = () => {
        img.src = resizeImageToDataUrl(tempImg, 700);
        btn.classList.add('has-photo');
        saveState();
      };
      tempImg.onerror = () => alert('Não foi possível ler essa imagem. Tente outro arquivo.');
      tempImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
    // Limpa o input para permitir selecionar o mesmo arquivo de novo, se preciso.
    input.value = '';
  });
}

function wirePortraits() {
  setupPortraitUpload('portraitBtn-main', 'portraitInput-main', 'portraitImg-main');
  setupPortraitUpload('portraitBtn-full', 'portraitInput-full', 'portraitImg-full');
}

function wireToolbar() {
  document.getElementById('btnPrint').addEventListener('click', () => window.print());
  document.getElementById('btnReset').addEventListener('click', () => {
    // Ficha conectada à Artemis: o botão vira "Desconectar" (não apaga a ficha do Discord)
    if (window.ArtemisOnline && window.ArtemisOnline.ativo) {
      if (confirm('Desconectar esta ficha da Artemis neste navegador? A ficha continua salva no Discord.')) {
        window.ArtemisOnline.desconectar();
      }
      return;
    }
    const ok = confirm('Isso vai apagar todos os dados preenchidos nesta ficha. Deseja continuar?');
    if (!ok) return;
    localStorage.removeItem(STATE_KEY);
    location.reload();
  });
}

let saveTimeout = null;
function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveState, 350);
}

/** Delegação: qualquer digitação em input/contenteditable agenda um salvamento. */
function wireDelegatedInput() {
  document.addEventListener('input', (e) => {
    if (e.target.matches('input[type="text"], textarea[data-key], [contenteditable="true"]')) {
      scheduleSave();
    }
  });
}

/* ==========================================================================
   5) PERSISTÊNCIA — localStorage
   ========================================================================== */

function collectState() {
  const state = { fields: {}, dots: {}, checks: {}, bars: {}, portraits: {} };

  document.querySelectorAll('input[type="text"][data-key]').forEach((el) => {
    state.fields[el.dataset.key] = el.value;
  });
  document.querySelectorAll('[contenteditable="true"][data-key]').forEach((el) => {
    state.fields[el.dataset.key] = el.textContent;
  });
  document.querySelectorAll('textarea[data-key]').forEach((el) => {
    state.fields[el.dataset.key] = el.value;
  });
  document.querySelectorAll('.dots[data-key]').forEach((el) => {
    state.dots[el.dataset.key] = el.dataset.value || '0';
  });
  document.querySelectorAll('.status-row.checked[data-key]').forEach((el) => {
    state.checks[el.dataset.group] = el.dataset.key;
  });
  document.querySelectorAll('.bar-group').forEach((el) => {
    state.bars[el.dataset.bar] = {
      cur: el.querySelector('.bar-current').textContent,
      max: el.querySelector('.bar-max').textContent,
    };
  });
  document.querySelectorAll('.portrait-img').forEach((el) => {
    if (el.getAttribute('src')) state.portraits[el.id] = el.getAttribute('src');
  });

  return state;
}

function saveState() {
  // Ficha conectada à Artemis: salva no Firebase em vez do navegador
  if (window.ARTEMIS_ONLINE) {
    if (window.ArtemisOnline && window.ArtemisOnline.ativo) {
      window.ArtemisOnline.salvar(collectState());
      flashSaveIndicator();
    }
    return;
  }
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(collectState()));
    flashSaveIndicator();
  } catch (err) {
    console.warn('Não foi possível salvar a ficha (localStorage indisponível ou cheio).', err);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('Não foi possível carregar a ficha salva anteriormente.', err);
    return null;
  }
}

/** Nomes que mudaram na ficha: Estamina virou Vigor e Liderança virou Instrução.
 *  Fichas salvas antes da mudança continuam com os pontos no lugar certo. */
const RENOMEADOS = [
  ['attr-fisicos-estamina-', 'attr-fisicos-vigor-', 'Estamina', 'Vigor'],
  ['skill-talentos-lideranca-', 'skill-talentos-instrucao-', 'Liderança', 'Instrução'],
];

function migrarNomesAntigos(state) {
  ['fields', 'dots'].forEach((secao) => {
    const dados = state[secao];
    if (!dados) return;
    Object.keys(dados).forEach((key) => {
      RENOMEADOS.forEach(([antigo, novo, rotuloAntigo, rotuloNovo]) => {
        if (!key.startsWith(antigo)) return;
        const novaKey = novo + key.slice(antigo.length);
        let valor = dados[key];
        if (key.endsWith('-label') && valor.trim() === rotuloAntigo) valor = rotuloNovo;
        if (!(novaKey in dados)) dados[novaKey] = valor;
        delete dados[key];
      });
    });
  });
}

function applyState(state) {
  if (!state) return;
  migrarNomesAntigos(state);

  Object.entries(state.fields || {}).forEach(([key, value]) => {
    const input = document.querySelector(`input${keySelector(key)}`);
    if (input) { input.value = value; return; }
    const area = document.querySelector(`textarea${keySelector(key)}`);
    if (area) { area.value = value; return; }
    const editable = document.querySelector(`[contenteditable="true"]${keySelector(key)}`);
    if (editable) editable.textContent = value;
  });

  Object.entries(state.dots || {}).forEach(([key, value]) => {
    const wrap = document.querySelector(`.dots${keySelector(key)}`);
    if (wrap) setDotsValue(wrap, parseInt(value, 10) || 0);
  });

  Object.entries(state.checks || {}).forEach(([, key]) => {
    const row = document.querySelector(`.status-row${keySelector(key)}`);
    if (row) row.classList.add('checked');
  });

  Object.entries(state.bars || {}).forEach(([bar, val]) => {
    const group = document.querySelector(`.bar-group[data-bar="${bar}"]`);
    if (group) {
      group.querySelector('.bar-current').textContent = val.cur;
      group.querySelector('.bar-max').textContent = val.max;
      updateBarFill(group);
    }
  });

  Object.entries(state.portraits || {}).forEach(([id, src]) => {
    const img = document.getElementById(id);
    if (img) {
      img.src = src;
      const btn = img.closest('button');
      if (btn) btn.classList.add('has-photo');
    }
  });

  refreshNotes(true); // abre a página de anotações se houver texto salvo
}

let flashTimeout = null;
function flashSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  if (!el) return;
  el.textContent = 'Salvo ✓';
  el.classList.add('show');
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => el.classList.remove('show'), 1200);
}

/* ==========================================================================
   5b) SISTEMA DE ROLAGEM — Modo Narrativo e Modo Clássico
   ========================================================================== */

/** Regra de sucesso no d12:
 *  1–5 nenhum sucesso · 6–11 = 1 sucesso · 12 = 2 sucessos (crítico). */
function successesForDie(value) {
  if (value === 12) return 2;
  if (value >= 6) return 1;
  return 0;
}

/** Faixa de cor do total de sucessos (as cores ficam no style.css, por tema):
 *  0 · 1–2 · 3–4 · 5–6 · 7–8 · 9+ */
function scoreClass(total) {
  if (total <= 0) return 'res-0';
  if (total <= 2) return 'res-1';
  if (total <= 4) return 'res-2';
  if (total <= 6) return 'res-3';
  if (total <= 8) return 'res-4';
  return 'res-5';
}

function scoreHtml(total) {
  return `
    <div class="roll-score ${scoreClass(total)}">
      <span class="roll-score-num">${total}</span>
      <span class="roll-score-label">${total === 1 ? 'sucesso' : 'sucessos'}</span>
    </div>`;
}

let rollMode = 'narrativo';

/** Seleciona uma linha de Atributo ou Perícia (uma por tipo, clique de novo desmarca). */
function selectTraitRow(row) {
  const role = row.dataset.role;
  const alreadySelected = row.classList.contains('selected');
  document.querySelectorAll(`.trait-row[data-role="${role}"].selected`).forEach((r) => r.classList.remove('selected'));
  if (!alreadySelected) row.classList.add('selected');
  saveState();
}

/** Lê o Atributo ou Perícia atualmente selecionado (rótulo + valor dos pontos). */
function getSelectedTrait(role) {
  const row = document.querySelector(`.trait-row[data-role="${role}"].selected`);
  if (!row) return null;
  const label = row.querySelector('.trait-label').textContent.trim();
  const dotsWrap = row.querySelector('.dots');
  const value = parseInt(dotsWrap.dataset.value, 10) || 0;
  return { label, value };
}

/** Penalidade cumulativa dos estados marcados em Saúde e Sanidade (número ≤ 0). */
function getHealthPenalty() {
  let total = 0;
  const saude = document.querySelector('.status-row.checked[data-group="saude"]');
  const sanidade = document.querySelector('.status-row.checked[data-group="sanidade"]');
  [saude, sanidade].forEach((row) => {
    if (!row) return;
    const mod = row.querySelector('.status-mod').textContent.trim();
    if (mod === '-') return;
    total += parseInt(mod, 10) || 0;
  });
  return total; // 0 ou negativo
}

function rollD12() {
  return 1 + Math.floor(Math.random() * 12);
}

function wireRollSystem() {
  // Clicar no dado rola; clicar de novo durante a animação pula ela.
  document.getElementById('diceRollBtn').addEventListener('click', () => {
    if (diceRolling) skipDice();
    else performRoll();
  });
}

/** Troca o modo de rolagem (vem da aba de configurações) e limpa o resultado anterior. */
function setRollMode(mode) {
  rollMode = mode === 'classico' ? 'classico' : 'narrativo';
  renderRollEmpty();
}

function renderRollEmpty() {
  cancelDiceAnimation();
  const nome = rollMode === 'classico' ? 'Clássico' : 'Narrativo';
  document.getElementById('rollResult').innerHTML =
    '<p class="roll-empty">Selecione um Atributo e uma Perícia e clique no dado.' +
    `<span class="roll-empty-sub">Modo ${nome} · mude em Configurações</span></p>`;
}

/* --------------------------------------------------------------------------
   ANIMAÇÃO DO DADO DO BURACO NEGRO
   O buraco negro se mexe, o dado treme e gira, para mostrando na face do
   meio o valor de um dado; repete para cada dado da reserva e no fim volta
   a ser o buraco negro. Os dados vão aparecendo no painel conforme param.
   Clicar no dado durante a animação pula direto para o resultado.
   -------------------------------------------------------------------------- */

/** Liga/desliga a animação (controlado pela aba de configurações). */
let animarDado = true;

let diceRolling = false;
let diceToken = 0;        // muda a cada rolagem/cancelamento para interromper animações antigas
let skipRequested = false; // pedido de "pular animação"
let sleepEnd = null;       // encerra a espera atual quando a animação é pulada

function wait(ms) {
  return new Promise((r) => {
    sleepEnd = r;
    setTimeout(r, ms);
  });
}

/** Roda uma animação e espera terminar (sem quebrar se for cancelada). */
function play(el, keyframes, options) {
  const anim = el.animate(keyframes, { fill: 'forwards', ...options });
  return anim.finished.catch(() => {});
}

function diceParts() {
  const svg = document.getElementById('diceSvg');
  return {
    btn: document.getElementById('diceRollBtn'),
    body: svg.querySelector('.dice-body'),
    hole: svg.querySelector('.dice-hole'),
    num: svg.querySelector('.dice-face-num'),
  };
}

/** Volta o dado ao estado parado (buraco negro visível, sem número). */
function resetDice() {
  const { btn, body, hole, num } = diceParts();
  [body, hole, num].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  num.textContent = '';
  num.classList.remove('is-success', 'is-crit');
  btn.classList.remove('is-rolling');
  diceRolling = false;
}

function cancelDiceAnimation() {
  diceToken++;
  if (sleepEnd) sleepEnd();
  resetDice();
}

/** Pula a animação em andamento: o resultado completo aparece de uma vez. */
function skipDice() {
  if (!diceRolling) return;
  skipRequested = true;
  const { body, hole, num } = diceParts();
  [body, hole, num].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
  if (sleepEnd) sleepEnd();
}

/** Tempo por dado: ~meio segundo, acelerando a partir de 8 dados. */
function msPerDie(count) {
  if (count < 8) return 500;
  return Math.max(220, Math.round(3600 / count));
}

/**
 * Anima a sequência de valores no dado.
 * colorFor(valor) devolve '', 'is-success' ou 'is-crit' para a cor do número.
 * onStop(valor, índice) é chamado quando cada dado para.
 * Devolve true (terminou), 'pulado' (a pessoa pulou) ou false (foi cancelada).
 */
async function animateDice(values, colorFor, onStop) {
  const token = ++diceToken;
  skipRequested = false;
  const { btn, body, hole, num } = diceParts();
  const per = msPerDie(values.length);
  const spinMs = Math.round(per * 0.55);
  const holdMs = per - spinMs;

  // Devolve o resultado final se a animação deve parar agora; senão, undefined.
  const parou = () => {
    if (token !== diceToken) return false;
    if (skipRequested) {
      skipRequested = false;
      resetDice();
      return 'pulado';
    }
    return undefined;
  };

  diceRolling = true;
  btn.classList.add('is-rolling');

  // 1) O buraco negro faz um movimento pequeno e some para dentro.
  await play(hole, [
    { transform: 'scale(1) rotate(0deg)', opacity: 1 },
    { transform: 'scale(1.12) rotate(-12deg)', opacity: 1, offset: 0.4 },
    { transform: 'scale(0.2) rotate(40deg)', opacity: 0 },
  ], { duration: 260, easing: 'ease-in' });
  let fim = parou();
  if (fim !== undefined) return fim;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    // 2) Esconde o número anterior; o dado treme e gira.
    num.getAnimations().forEach((a) => a.cancel());
    num.style.opacity = '0';
    await play(body, [
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: 'translate(-2px,1px) rotate(-8deg)', offset: 0.12 },
      { transform: 'translate(2px,-1px) rotate(8deg)', offset: 0.24 },
      { transform: 'translate(0,0) rotate(360deg)' },
    ], { duration: spinMs, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'none' });
    fim = parou();
    if (fim !== undefined) return fim;

    // 3) Para mostrando o valor na face do meio.
    num.textContent = v;
    num.classList.remove('is-success', 'is-crit');
    const cls = colorFor(v);
    if (cls) num.classList.add(cls);
    num.style.opacity = '';
    const pop = cls === 'is-crit' ? 1.25 : 1.1;
    play(num, [
      { transform: `scale(${pop})`, opacity: 0 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: Math.min(160, holdMs) });
    onStop(v, i);

    await wait(holdMs);
    fim = parou();
    if (fim !== undefined) return fim;
  }

  // 4) O número some e o buraco negro volta.
  await play(num, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
  fim = parou();
  if (fim !== undefined) return fim;
  await play(hole, [
    { transform: 'scale(0.2) rotate(40deg)', opacity: 0 },
    { transform: 'scale(1.08) rotate(-6deg)', opacity: 1, offset: 0.7 },
    { transform: 'scale(1) rotate(0deg)', opacity: 1 },
  ], { duration: 280, easing: 'ease-out' });
  fim = parou();
  if (fim !== undefined) return fim;

  resetDice();
  return true;
}

/**
 * Avisa a Artemis (Discord) da rolagem feita no site. Só acontece com a ficha
 * conectada; sem conexão, ou se o aviso não chegar, nada acontece.
 */
function registrarLog(info) {
  try {
    const on = window.ArtemisOnline;
    if (on && on.ativo && typeof on.registrarRolagem === 'function') on.registrarRolagem(info);
  } catch (err) { /* o log é opcional */ }
}

function performRoll() {
  if (diceRolling) return; // ignora cliques enquanto o dado está girando

  const attr = getSelectedTrait('attribute');
  const skill = getSelectedTrait('skill');
  const box = document.getElementById('rollResult');

  if (!attr || !skill) {
    box.innerHTML = '<p class="roll-empty">Selecione um Atributo e uma Perícia e clique no dado.</p>';
    return;
  }

  const penalty = getHealthPenalty();

  if (rollMode === 'narrativo') {
    renderNarrativo(attr, skill, penalty);
  } else {
    renderClassico(attr, skill, penalty);
  }
}

function dieChipHtml(v, pop) {
  const cls = v === 12 ? 'roll-die crit' : successesForDie(v) > 0 ? 'roll-die success' : 'roll-die';
  return `<span class="${cls}${pop ? ' pop' : ''}">${v}</span>`;
}

function dieColorClass(v) {
  if (v === 12) return 'is-crit';
  return successesForDie(v) > 0 ? 'is-success' : '';
}

async function renderNarrativo(attr, skill, penalty) {
  const initialPool = attr.value + skill.value;
  const finalPool = Math.max(1, initialPool + penalty);
  const rolls = Array.from({ length: finalPool }, rollD12);
  const successes = rolls.reduce((sum, v) => sum + successesForDie(v), 0);

  const box = document.getElementById('rollResult');
  box.innerHTML = `
    <div class="roll-line"><span>Modo</span><strong>Narrativo</strong></div>
    <div class="roll-line"><span>Atributo</span><strong>${attr.label} ${attr.value}</strong></div>
    <div class="roll-line"><span>Perícia</span><strong>${skill.label} ${skill.value}</strong></div>
    <div class="roll-line"><span>Reserva inicial</span><strong>${initialPool}d12</strong></div>
    <div class="roll-line"><span>Penalidades</span><strong>${penalty}</strong></div>
    <div class="roll-line"><span>Reserva final</span><strong>${finalPool}d12</strong></div>
    <div class="roll-dice-values"></div>
  `;
  const diceRow = box.querySelector('.roll-dice-values');
  const showTotal = () => box.insertAdjacentHTML('beforeend', scoreHtml(successes));
  const registrar = () => registrarLog({ modo: 'narrativo', atributo: attr, habilidade: skill, penalidade: penalty, dados: rolls });

  if (!animarDado) {
    diceRow.innerHTML = rolls.map((v) => dieChipHtml(v, false)).join('');
    showTotal();
    registrar();
    return;
  }

  const fim = await animateDice(rolls, dieColorClass, (v) => {
    diceRow.insertAdjacentHTML('beforeend', dieChipHtml(v, true));
  });
  if (fim === 'pulado') {
    diceRow.innerHTML = rolls.map((v) => dieChipHtml(v, false)).join('');
  }
  if (fim) showTotal();
  registrar(); // a rolagem aconteceu mesmo se a animação foi interrompida
}

async function renderClassico(attr, skill, penalty) {
  const natural = rollD12();
  const subtotal = natural + attr.value + skill.value;
  const final = subtotal + penalty;

  const html = `
    <div class="roll-line"><span>Modo</span><strong>Clássico</strong></div>
    <div class="roll-line"><span>d12 natural</span><strong>${natural}</strong></div>
    <div class="roll-line"><span>Atributo</span><strong>${attr.label} ${attr.value}</strong></div>
    <div class="roll-line"><span>Perícia</span><strong>${skill.label} ${skill.value}</strong></div>
    <div class="roll-line"><span>Penalidades</span><strong>${penalty}</strong></div>
    <div class="roll-final">Resultado final: ${final}</div>
  `;
  const box = document.getElementById('rollResult');
  const registrar = () => registrarLog({ modo: 'classico', atributo: attr, habilidade: skill, penalidade: penalty, dados: [natural] });

  if (!animarDado) {
    box.innerHTML = html;
    registrar();
    return;
  }

  // Uma parada só, com o d12 natural (número neutro no Clássico).
  box.innerHTML = '<p class="roll-empty">Rolando...</p>';
  const fim = await animateDice([natural], () => '', () => {
    box.innerHTML = html;
  });
  if (fim === 'pulado') box.innerHTML = html;
  registrar();
}

/* ==========================================================================
   5c) CONFIGURAÇÕES — aba lateral (abre pela esquerda)
   Ficam só neste navegador (não vão para a ficha nem para a Artemis).
   Para criar uma opção nova: coloque um controle com data-cfg="nome" no
   index.html, um valor padrão em CFG_PADRAO e trate o nome em aplicarCfg().
   ========================================================================== */

const CFG_KEY = 'bhcConfig_v1';
const CFG_PADRAO = { tema: 'escuro', modo: 'narrativo', animacao: true, notasNoPdf: true };
const cfg = { ...CFG_PADRAO };

function carregarCfg() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    if (salvo.tema === 'escuro' || salvo.tema === 'claro') cfg.tema = salvo.tema;
    if (salvo.modo === 'narrativo' || salvo.modo === 'classico') cfg.modo = salvo.modo;
    if (typeof salvo.animacao === 'boolean') cfg.animacao = salvo.animacao;
    if (typeof salvo.notasNoPdf === 'boolean') cfg.notasNoPdf = salvo.notasNoPdf;
  } catch (err) { /* sem armazenamento: usa os padrões */ }
}

function salvarCfg() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (err) { /* segue sem lembrar */ }
}

/** Aplica uma opção na ficha e atualiza os controles da aba. */
function aplicarCfg(nome) {
  if (nome === 'tema') document.documentElement.classList.toggle('tema-claro', cfg.tema === 'claro');
  if (nome === 'modo') setRollMode(cfg.modo);
  if (nome === 'animacao') animarDado = cfg.animacao;
  if (nome === 'notasNoPdf') document.documentElement.classList.toggle('sem-notas-pdf', !cfg.notasNoPdf);

  document.querySelectorAll(`.cfg-seg[data-cfg="${nome}"] button`).forEach((b) => {
    b.classList.toggle('active', b.dataset.value === String(cfg[nome]));
  });
  document.querySelectorAll(`input[type="checkbox"][data-cfg="${nome}"]`).forEach((c) => {
    c.checked = !!cfg[nome];
  });
}

function setCfgPanel(aberto) {
  const painel = document.getElementById('cfgPanel');
  const fundo = document.getElementById('cfgBackdrop');
  painel.classList.toggle('open', aberto);
  fundo.classList.toggle('open', aberto);
  painel.setAttribute('aria-hidden', String(!aberto));
  if (aberto) document.getElementById('cfgClose').focus();
  else document.getElementById('btnCfg').focus();
}

function wireSettings() {
  carregarCfg();

  document.querySelectorAll('.cfg-seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const nome = seg.dataset.cfg;
      if (cfg[nome] === b.dataset.value) return;
      cfg[nome] = b.dataset.value;
      aplicarCfg(nome);
      salvarCfg();
    });
  });
  document.querySelectorAll('input[type="checkbox"][data-cfg]').forEach((c) => {
    c.addEventListener('change', () => {
      cfg[c.dataset.cfg] = c.checked;
      aplicarCfg(c.dataset.cfg);
      salvarCfg();
    });
  });

  document.getElementById('btnCfg').addEventListener('click', () => setCfgPanel(true));
  document.getElementById('cfgClose').addEventListener('click', () => setCfgPanel(false));
  document.getElementById('cfgBackdrop').addEventListener('click', () => setCfgPanel(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('cfgPanel').classList.contains('open')) setCfgPanel(false);
  });

  Object.keys(CFG_PADRAO).forEach(aplicarCfg);
}

/* ==========================================================================
   5d) ANOTAÇÕES — página extra aberta pelo "+" embaixo da ficha
   Sem título, sem formatação. A página cresce conforme a pessoa escreve,
   pode ser minimizada (o texto fica guardado) e sai no PDF junto com a ficha.
   O texto é salvo como um campo comum da ficha (data-key="notas-livres").
   ========================================================================== */

function notesEls() {
  return {
    page: document.getElementById('notesPage'),
    text: document.getElementById('notesText'),
    mirror: document.getElementById('notesPrint'),
    add: document.getElementById('notesAdd'),
    addWrap: document.getElementById('notesAddWrap'),
  };
}

/** Ajusta a altura ao texto, atualiza a cópia de impressão e as marcas "tem texto". */
function refreshNotes(abrirSeTemTexto) {
  const { page, text, mirror, add } = notesEls();
  if (!page) return;
  const temTexto = text.value.trim() !== '';
  mirror.textContent = text.value;
  page.classList.toggle('tem-texto', temTexto);
  add.classList.toggle('tem-texto', temTexto);
  if (abrirSeTemTexto && temTexto) setNotesOpen(true);
  if (page.classList.contains('open')) {
    text.style.height = 'auto';
    text.style.height = text.scrollHeight + 'px';
  }
}

function setNotesOpen(aberta, focar) {
  const { page, text, addWrap } = notesEls();
  page.classList.toggle('open', aberta);
  addWrap.classList.toggle('oculto', aberta);
  if (aberta) {
    refreshNotes(false);
    if (focar) text.focus();
  }
}

function wireNotes() {
  const { text, add } = notesEls();
  add.addEventListener('click', () => setNotesOpen(true, true));
  document.getElementById('notesMin').addEventListener('click', () => {
    setNotesOpen(false);
    add.focus();
  });
  text.addEventListener('input', () => refreshNotes(false));
}


document.addEventListener('DOMContentLoaded', () => {
  // Monta as seções repetitivas da ficha a partir dos dados.
  buildStatusRows(document.querySelector('#statusBlock-saude .status-rows'), SAUDE_STATES, 'saude');
  buildStatusRows(document.querySelector('#statusBlock-sanidade .status-rows'), SANIDADE_STATES, 'sanidade');
  buildAttributesGrid();
  buildSkillsGrid();
  buildBlankRows('outrasRows', 7, 'outras');
  buildBlankRows('antecedentesRows', 6, 'antecedentes');
  buildInventory();
  buildQDRows('qualidadesRows', 'qualidade', 4);
  buildQDRows('defeitosRows', 'defeito', 4);
  buildWeaponsAndArmor();
  buildDescription();

  // Valores padrão do modelo original.
  setDefaults();
  estadoPadrao = collectState(); // usado pra "limpar" a ficha antes de carregar a do Firebase

  // Liga toda a interatividade.
  wireBarArrows();
  wireEditableNumberFields();
  wireEnterBlurs();
  wirePortraits();
  wireToolbar();
  wireDelegatedInput();
  wireRollSystem();
  wireNotes();
  wireSettings();

  // Restaura dados salvos (se existirem), sobrepondo os padrões.
  // Com a ficha conectada à Artemis, quem carrega os dados é o integracao.js.
  if (!window.ARTEMIS_ONLINE) applyState(loadState());
});

/* ==========================================================================
   7) PONTE COM A ARTEMIS — usada pelo integracao.js (Firebase)
   ========================================================================== */

let estadoPadrao = null;

/** Volta a ficha ao estado de ficha nova (sem apagar o que está salvo no navegador). */
function limparFicha() {
  if (estadoPadrao) applyState(estadoPadrao);
  document.querySelectorAll('.status-row.checked').forEach((r) => r.classList.remove('checked'));
  document.querySelectorAll('.trait-row.selected').forEach((r) => r.classList.remove('selected'));
  document.querySelectorAll('.portrait-img').forEach((img) => {
    img.removeAttribute('src');
    const btn = img.closest('button');
    if (btn) btn.classList.remove('has-photo');
  });
}

window.FichaBHC = {
  ATTRIBUTES, SKILLS, slug,
  collectState, applyState, loadState, limparFicha,
};
