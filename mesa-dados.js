/* ==========================================================================
   MESA — ONDE OS DADOS FICAM
   Dois "bancos" com a mesma interface:
     - criarLocal():    modo de teste, tudo só neste navegador
     - criarFirebase(): mesa de verdade, em tempo real para todo mundo (Firestore)
   A tela (mesa.js) não sabe qual dos dois está usando.

   Onde fica no Firestore (servidores/{s}/...):
     mesa/estado                    campanha, próxima sessão, cena ativa
     mesa_cenas/{cena}              nome, mapa (link), escala, grade, ativa
     mesa_cenas/{cena}/itens/{id}   bonecos, notas e traços do desenho
     mesa_presenca/{uid}            quem está conectado agora
     mesa_atividade/{id}            o que aconteceu (cena trocada, alguém entrou)
   ========================================================================== */

const agora = () => Date.now();
const novoId = () => Math.random().toString(36).slice(2, 10) + agora().toString(36).slice(-4);

/* --------------------------------------------------------------------------
   LOCAL (modo de teste)
   -------------------------------------------------------------------------- */
export function criarLocal() {
  const CHAVE = 'bhcMesaLocal_v1';
  let dados;
  try { dados = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (e) { dados = null; }
  if (!dados) dados = { estado: {}, cenas: {}, itens: {}, atividade: [] };
  const ouvintes = new Set();
  const salvar = () => {
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (e) { /* cheio: segue só na memória */ }
    ouvintes.forEach((f) => f());
  };
  const ouvir = (fn) => { ouvintes.add(fn); queueMicrotask(fn); return () => ouvintes.delete(fn); };
  const copia = (o) => JSON.parse(JSON.stringify(o));

  return {
    tipo: 'local',
    uid: 'local',
    mestre: true,
    mesa: true,
    nome: 'Você',

    estado: {
      ouvir: (cb) => ouvir(() => cb(copia(dados.estado))),
      salvar: async (patch) => { Object.assign(dados.estado, patch); salvar(); },
    },
    cenas: {
      ouvir: (cb) => ouvir(() => cb(Object.entries(dados.cenas).map(([id, c]) => ({ id, ...copia(c) })))),
      criar: async (c) => { const id = novoId(); dados.cenas[id] = { ativa: false, criado: agora(), ...c }; salvar(); return id; },
      atualizar: async (id, patch) => { if (dados.cenas[id]) { Object.assign(dados.cenas[id], patch); salvar(); } },
      apagar: async (id) => { delete dados.cenas[id]; delete dados.itens[id]; salvar(); },
      ativar: async (id, estadoNovo) => {
        Object.keys(dados.cenas).forEach((k) => { dados.cenas[k].ativa = k === id; });
        Object.assign(dados.estado, estadoNovo); salvar();
      },
    },
    itens: {
      ouvir: (cenaId, opcoes, cb) => ouvir(() => {
        const todos = Object.entries(dados.itens[cenaId] || {}).map(([id, i]) => ({ id, ...copia(i) }));
        cb(opcoes.ocultos ? todos : todos.filter((i) => !i.oculto));
      }),
      criar: async (cenaId, item) => { const id = novoId(); (dados.itens[cenaId] = dados.itens[cenaId] || {})[id] = { oculto: false, ...item }; salvar(); return id; },
      salvar: async (cenaId, id, patch) => { const o = (dados.itens[cenaId] || {})[id]; if (o) { Object.assign(o, patch, { atualizado: agora() }); salvar(); } },
      apagar: async (cenaId, id) => { if (dados.itens[cenaId]) { delete dados.itens[cenaId][id]; salvar(); } },
    },
    presenca: {
      ouvir: (cb) => { queueMicrotask(() => cb([{ id: 'local', nome: 'Você', sigla: 'VC', cor: '#CC7A00', mestre: true, visto: agora() }])); return () => {}; },
      bater: async () => {},
    },
    atividade: { registrar: async (texto) => { dados.atividade.unshift({ texto, em: agora() }); dados.atividade.length = Math.min(dados.atividade.length, 20); salvar(); } },
    fichas: {
      // no modo de teste só existe a ficha deste navegador
      ouvirTodas: (cb) => {
        let r = null;
        try { r = JSON.parse(localStorage.getItem('bhcResumo_v1') || 'null'); } catch (e) { /* sem ficha */ }
        const lista = r ? [{ id: 'local', nome: r.nome || 'Minha ficha', dono: 'local', barras: { vida: { atual: r.vida?.cur ?? 10, max: r.vida?.max ?? 10 } } }] : [];
        queueMicrotask(() => cb(lista));
        return () => {};
      },
      ouvir: () => () => {},
      salvarBarras: async () => {},
    },
  };
}

/* --------------------------------------------------------------------------
   FIREBASE (mesa de verdade)
   -------------------------------------------------------------------------- */
export function criarFirebase(sessao) {
  const { fb, db, s, uid, mestre } = sessao;
  const base = ['servidores', s];
  const col = (...p) => fb.collection(db, ...base, ...p);
  const ref = (...p) => fb.doc(db, ...base, ...p);
  const limpar = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));
  const falhou = (onde) => (e) => { console.error('Mesa (' + onde + '):', e); throw e; };
  const erroOuvir = (onde) => (e) => console.warn('Mesa: sem acesso a ' + onde, e);

  return {
    tipo: 'firebase',
    uid, mestre, mesa: sessao.mesa, nome: sessao.nome || '',

    estado: {
      ouvir: (cb) => fb.onSnapshot(ref('mesa', 'estado'), (d) => cb(d.exists() ? d.data() : {}), erroOuvir('à campanha')),
      salvar: (patch) => fb.setDoc(ref('mesa', 'estado'), limpar(patch), { merge: true }).catch(falhou('estado')),
    },

    cenas: {
      ouvir: (cb) => {
        const q = mestre ? col('mesa_cenas') : fb.query(col('mesa_cenas'), fb.where('ativa', '==', true));
        return fb.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), erroOuvir('às cenas'));
      },
      criar: async (c) => {
        const r = await fb.addDoc(col('mesa_cenas'), limpar({ ativa: false, criado: agora(), ...c })).catch(falhou('cena'));
        return r.id;
      },
      atualizar: (id, patch) => fb.updateDoc(ref('mesa_cenas', id), limpar(patch)).catch(falhou('cena')),
      apagar: async (id) => {
        // apaga os itens da cena junto (o Firestore não faz isso sozinho)
        const itens = await fb.getDocs(col('mesa_cenas', id, 'itens'));
        const lote = fb.writeBatch(db);
        itens.forEach((d) => lote.delete(d.ref));
        lote.delete(ref('mesa_cenas', id));
        await lote.commit().catch(falhou('apagar cena'));
      },
      ativar: async (id, estadoNovo) => {
        const todas = await fb.getDocs(col('mesa_cenas'));
        const lote = fb.writeBatch(db);
        todas.forEach((d) => lote.update(d.ref, { ativa: d.id === id }));
        lote.set(ref('mesa', 'estado'), limpar(estadoNovo), { merge: true });
        await lote.commit().catch(falhou('ativar cena'));
      },
    },

    itens: {
      ouvir: (cenaId, opcoes, cb) => {
        const c = col('mesa_cenas', cenaId, 'itens');
        const q = opcoes.ocultos ? c : fb.query(c, fb.where('oculto', '==', false));
        return fb.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), erroOuvir('aos itens'));
      },
      criar: async (cenaId, item) => {
        const r = await fb.addDoc(col('mesa_cenas', cenaId, 'itens'), limpar({ oculto: false, dono: '', ...item, atualizado: agora() })).catch(falhou('criar item'));
        return r.id;
      },
      salvar: (cenaId, id, patch) => fb.updateDoc(ref('mesa_cenas', cenaId, 'itens', id), limpar({ ...patch, atualizado: agora() })).catch((e) => console.warn('Mesa: item não salvo', e)),
      apagar: (cenaId, id) => fb.deleteDoc(ref('mesa_cenas', cenaId, 'itens', id)).catch(falhou('apagar item')),
    },

    presenca: {
      ouvir: (cb) => fb.onSnapshot(col('mesa_presenca'), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), erroOuvir('à presença')),
      bater: (info) => fb.setDoc(ref('mesa_presenca', uid), limpar({ ...info, visto: agora() })).catch((e) => console.warn('Mesa: presença', e)),
    },

    atividade: {
      registrar: (texto) => fb.addDoc(col('mesa_atividade'), { texto: String(texto).slice(0, 140), uid, criado: fb.serverTimestamp() }).catch((e) => console.warn('Mesa: atividade', e)),
    },

    fichas: {
      // mestre: todas as fichas do servidor; jogador: não usa
      ouvirTodas: (cb) => fb.onSnapshot(col('personagens'), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), erroOuvir('às fichas')),
      ouvir: (id, cb) => fb.onSnapshot(ref('personagens', id), (d) => cb(d.exists() ? { id: d.id, ...d.data() } : null), erroOuvir('à ficha')),
      salvarBarras: (id, barras) => fb.updateDoc(ref('personagens', id), { barras: limpar(barras), atualizado_em: new Date().toISOString() }).catch((e) => console.warn('Mesa: ficha não atualizada', e)),
    },
  };
}
