
// ====== CONFIG À RENSEIGNER ======
// Récupère ces valeurs dans https://dev.twitch.tv/console/apps
const TWITCH_CLIENT_ID = "ewuh2nhhg1cfre8dwvwjb54gosuyvo"; // ex: abcdef1234567890
const TWITCH_APP_TOKEN = "x3d8u4uy6rroys2pgvsj7dhgn51ono"; // "App Access Token" (Client Credentials)
const REFRESH_MS = 60_000; // 60 s
const STREAMERS_TXT_URL = "streamers.txt"; // chemin vers la liste

// Les organisateurs affichés en haut dans leur section dédiée
const ORGANIZERS = ["Pochoskywalker", "GarleyQuinn", "Ninistre"];

// ====== OUTILS TWITCH ======
const twitchHeaders = {
  "Client-ID": TWITCH_CLIENT_ID,
  "Authorization": `Bearer ${TWITCH_APP_TOKEN}`,
};

async function fetchStreamersList() {
  const res = await fetch(STREAMERS_TXT_URL, { cache: "no-store" });
  const text = await res.text();
  return text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

function chunk(arr, n) { return arr.length ? [arr.slice(0, n), ...chunk(arr.slice(n), n)] : []; }

async function helix(endpoint, params = new URLSearchParams()) {
  const url = `https://api.twitch.tv/helix/${endpoint}?${params.toString()}`;
  const res = await fetch(url, { headers: twitchHeaders });
  if (res.status === 401) throw new Error("TOKEN_EXPIRED");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getUsers(logins) {
  const batches = chunk(logins, 100);
  const users = [];
  for (const batch of batches) {
    const params = new URLSearchParams();
    batch.forEach(l => params.append("login", l));
    const data = await helix("users", params);
    if (data.data) users.push(...data.data);
  }
  return users; // [{id, login, display_name, profile_image_url}]
}

async function getStreamsByLogin(logins) {
  const batches = chunk(logins, 100);
  const streams = [];
  for (const batch of batches) {
    const params = new URLSearchParams();
    batch.forEach(l => params.append("user_login", l));
    params.set("type", "live");
    const data = await helix("streams", params);
    if (data.data) streams.push(...data.data);
  }
  const map = new Map();
  for (const s of streams) map.set(s.user_login.toLowerCase(), s);
  return map; // login -> stream
}

function fmtNumber(n) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

function bySort(a, b) {
  // live d'abord (par viewers desc), puis alpha
  if (a.live && !b.live) return -1;
  if (!a.live && b.live) return 1;
  if (a.live && b.live) return (b.viewers||0) - (a.viewers||0);
  return a.login.localeCompare(b.login, "fr", {sensitivity: "base"});
}

function createCardNode(tpl, c) {
  const node = tpl.content.cloneNode(true);
  const thumbLink = node.querySelector('.thumb-link');
  const thumb = node.querySelector('.thumb');
  const avatar = node.querySelector('.avatar');
  const loginA = node.querySelector('.login');
  const pill = node.querySelector('.live-pill');
  const titleEl = node.querySelector('.title');
  const statsEl = node.querySelector('.stats');

  const url = `https://twitch.tv/${c.login}`;
  loginA.textContent = c.display_name || c.login;
  loginA.href = url;
  thumbLink.href = url;

  avatar.src = c.profile_image_url || "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_fallback/default/dark/1.0";

  if (c.live) {
    pill.textContent = `LIVE • ${fmtNumber(c.viewers)} viewers`;
    pill.classList.add('live');
    const t = c.title || '';
    titleEl.textContent = t;
    statsEl.textContent = c.game_name ? c.game_name : '';
    if (c.thumbnail_url) {
      const src = c.thumbnail_url.replace("{width}", "640").replace("{height}", "360");
      thumb.src = src + `?t=${Date.now()}`; // éviter cache
    }
  } else {
    pill.textContent = 'Hors ligne';
    pill.classList.add('offline');
    titleEl.textContent = '';
    statsEl.textContent = '';
    thumb.src = 'assets/logo.png';
  }
  return node;
}

function renderSection(cards, gridId) {
  const grid = document.getElementById(gridId);
  const tpl = document.getElementById("card-tpl");
  grid.innerHTML = "";
  for (const c of cards) {
    grid.appendChild(createCardNode(tpl, c));
  }
}

function filterCards(all, q) {
  if (!q) return all;
  q = q.toLowerCase();
  return all.filter(c =>
    c.login.toLowerCase().includes(q) ||
    (c.display_name||'').toLowerCase().includes(q) ||
    (c.title||'').toLowerCase().includes(q)
  );
}

async function refresh() {
  const warn = document.getElementById('warn');
  warn.hidden = true;
  try {
    const rawLogins = (await fetchStreamersList()).map(s => s.replace(/^@/, '')).filter(Boolean);

    // Build organizer + participant lists while preserving presence even if not in text list
    const organizersSet = new Set(ORGANIZERS.map(s => s.toLowerCase()));
    // Ensure organizers are included even if missing from streamers.txt
    const allLogins = Array.from(new Set([...rawLogins, ...ORGANIZERS])).map(s => s.trim()).filter(Boolean);

    const users = await getUsers(allLogins);
    const streamsMap = await getStreamsByLogin(allLogins);
    const usersByLogin = new Map(users.map(u => [u.login.toLowerCase(), u]));

    const cardsAll = allLogins.map(login => {
      const u = usersByLogin.get(login.toLowerCase()) || { login };
      const s = streamsMap.get(login.toLowerCase());
      return {
        login: u.login || login,
        display_name: u.display_name || login,
        profile_image_url: u.profile_image_url,
        live: !!s,
        viewers: s?.viewer_count,
        title: s?.title,
        game_name: s?.game_name,
        thumbnail_url: s?.thumbnail_url,
        isOrganizer: organizersSet.has(login.toLowerCase()),
      };
    });

    const input = document.getElementById('search');
    const q = input.value;

    // Split organizers / participants
    const orgCards = cardsAll.filter(c => c.isOrganizer).sort(bySort);
    const partCards = cardsAll.filter(c => !c.isOrganizer).sort(bySort);

    // Apply filter to each section
    const orgFiltered = filterCards(orgCards, q);
    const partFiltered = filterCards(partCards, q);

    renderSection(orgFiltered, "grid-organizers");
    renderSection(partFiltered, "grid-participants");

    const liveCount = cardsAll.filter(c => c.live).length;
    document.getElementById('countLive').textContent = `${liveCount} en live`;
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    document.getElementById('countOrganizers').textContent = `${orgFiltered.length} affiché·e·s`;
    document.getElementById('countParticipants').textContent = `${partFiltered.length} affiché·e·s`;
  } catch (e) {
    console.error(e);
    if (String(e).includes('TOKEN_EXPIRED')) {
      document.getElementById('warn').textContent = "Token Twitch expiré ou invalide. Regénérez un App Access Token et remplacez-le dans app.js.";
    } else {
      document.getElementById('warn').textContent = `Erreur de chargement : ${e.message || e}`;
    }
    document.getElementById('warn').hidden = false;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('search');
  input.addEventListener('input', () => refresh());
  refresh();
  setInterval(refresh, REFRESH_MS);
});
