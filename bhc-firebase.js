/* ==========================================================================
   CONEXÃO COMPARTILHADA COM O FIREBASE (página inicial e mesa)
   --------------------------------------------------------------------------
   O comando /mesa da Artemis entrega um link tipo
       .../mesa.html?s=SERVIDOR#t=TOKEN
   O TOKEN faz o login (e carrega no login se a pessoa é mestre ou jogador).
   O navegador continua logado depois; s fica salvo para as próximas vezes.
   A ficha (integracao.js) usa o mesmo login, então não precisa logar duas vezes.
   ========================================================================== */

export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CHAVE_MESA = 'artemis_mesa';
const CHAVE_VINCULO = 'artemis_vinculo';

const ler = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const gravar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };

export function firebaseConfigurado() {
  const cfg = window.FIREBASE_CONFIG || {};
  return !!(cfg.apiKey && String(cfg.apiKey).indexOf('COLE_') !== 0);
}

/** Qual servidor (Discord) está ligado a este navegador, ou null. */
export function servidorSalvo() {
  const m = ler(CHAVE_MESA);
  if (m && m.s) return String(m.s);
  const v = ler(CHAVE_VINCULO);
  return v && v.s ? String(v.s) : null;
}

export function esquecerMesa() { gravar(CHAVE_MESA, null); }

/**
 * Entra no Firebase. Devolve:
 *   null                       -> sem link / sem Firebase (modo local)
 *   { erro: '...' }            -> não deu (link vencido etc.)
 *   { fb, app, auth, db, s, uid, mesa: bool, mestre: bool }
 */
export async function abrirSessao() {
  if (!firebaseConfigurado()) return null;
  const consulta = new URLSearchParams(location.search);
  const fragmento = new URLSearchParams(location.hash.slice(1));
  const token = fragmento.get('t');
  if (consulta.get('s')) gravar(CHAVE_MESA, { s: String(consulta.get('s')) });
  if (token || consulta.has('s')) history.replaceState(null, '', location.pathname);

  const s = servidorSalvo();
  if (!s) return null;

  const mods = await Promise.all([
    import(FIREBASE_SDK + 'firebase-app.js'),
    import(FIREBASE_SDK + 'firebase-auth.js'),
    import(FIREBASE_SDK + 'firebase-firestore.js'),
  ]);
  const fb = Object.assign({}, ...mods);
  const app = fb.getApps().length ? fb.getApp() : fb.initializeApp(window.FIREBASE_CONFIG);
  const auth = fb.getAuth(app);
  const db = fb.getFirestore(app);

  if (token) {
    try { await fb.signInWithCustomToken(auth, token); }
    catch (e) { console.error(e); return { erro: 'Esse link expirou ou é inválido. Peça um novo com /mesa no Discord.' }; }
  }
  await auth.authStateReady();
  if (!auth.currentUser) return { erro: 'Sessão expirada. Peça um link novo com /mesa no Discord.' };

  let claims = {};
  try { claims = (await auth.currentUser.getIdTokenResult()).claims || {}; } catch (e) { /* sem claims */ }
  const mesa = String(claims.mesa || '') === s;
  return { fb, app, auth, db, s, uid: auth.currentUser.uid, mesa, mestre: mesa && claims.mestre === true, nome: claims.nome || '' };
}
