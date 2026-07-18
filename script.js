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
  'Fisicos': ['Força', 'Destreza', 'Estamina'],
  'Sociais': ['Carisma', 'Manipulação', 'Aparencia'],
  'Mentais': ['Percepção', 'Inteligencia', 'Raciocionio'],
};

const SKILLS = {
  'Talentos': ['Alerta', 'Arte', 'Atletismo', 'Consciencia', 'Luta', 'Empatia', 'Expressão', 'Intimidação', 'Liderança', 'Manha', 'Lábia'],
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
function buildTraitRow(label, key) {
  const row = document.createElement('div');
  row.className = 'trait-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'trait-label';
  labelEl.contentEditable = 'true';
  labelEl.dataset.key = `${key}-label`;
  labelEl.textContent = label;

  const fill = document.createElement('span');
  fill.className = 'trait-fill';

  const dots = createDots(`${key}-dots`);

  row.append(labelEl, fill, dots);
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
      col.appendChild(buildTraitRow(item, `attr-${slug(colName)}-${slug(item)}`));
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
      col.appendChild(buildTraitRow(item, `skill-${slug(colName)}-${slug(item)}`));
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
      img.src = e.target.result;
      btn.classList.add('has-photo');
      saveState();
    };
    reader.readAsDataURL(file);
  });
}

function wirePortraits() {
  setupPortraitUpload('portraitBtn-main', 'portraitInput-main', 'portraitImg-main');
  setupPortraitUpload('portraitBtn-full', 'portraitInput-full', 'portraitImg-full');
}

function wireToolbar() {
  document.getElementById('btnPrint').addEventListener('click', () => window.print());
  document.getElementById('btnReset').addEventListener('click', () => {
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
    if (e.target.matches('input[type="text"], [contenteditable="true"]')) {
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

function applyState(state) {
  if (!state) return;

  Object.entries(state.fields || {}).forEach(([key, value]) => {
    const input = document.querySelector(`input${keySelector(key)}`);
    if (input) { input.value = value; return; }
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
   6) INICIALIZAÇÃO
   ========================================================================== */

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

  // Liga toda a interatividade.
  wireBarArrows();
  wireEditableNumberFields();
  wireEnterBlurs();
  wirePortraits();
  wireToolbar();
  wireDelegatedInput();

  // Restaura dados salvos (se existirem), sobrepondo os padrões.
  applyState(loadState());
});
