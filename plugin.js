(() => {
  'use strict';

  const PLUGIN_ID = 'tabroom-rounds';
  const BRIDGE_APP = 'tabroom-bridge';
  const AFF_SPEECHES = ['1AC', '2AC', '1AR', '2AR'];
  const NEG_SPEECHES = ['1NC', '2NC', '1NR', '2NR'];

  // CardMirror keeps plugin storage in localStorage under `plugin:<id>`, with
  // declared settings nested in that same object under `__settings`. The shim
  // below reads and writes exactly those, so a cold session and a normal one
  // share one store instead of drifting apart.
  const STORE_KEY = 'plugin:' + PLUGIN_ID;
  const SETTINGS_KEY = '__settings';

  let pluginApi = null;

  function domToast(msg) {
    let host = document.getElementById('tabroom-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tabroom-toast';
      host.style.cssText =
        'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'background:#232323;color:#fff;padding:8px 14px;border-radius:6px;font-size:13px;' +
        'max-width:70vw;box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;' +
        'transition:opacity .25s';
      document.body.appendChild(host);
    }
    host.textContent = String(msg);
    host.style.opacity = '1';
    clearTimeout(host._hide);
    host._hide = setTimeout(() => {
      host.style.opacity = '0';
    }, 4000);
  }

  function toast(msg) {
    try {
      if (pluginApi && pluginApi.showToast) {
        pluginApi.showToast(String(msg));
        return;
      }
    } catch (_) {}
    console.log('[Tabroom]', msg);
    try {
      domToast(msg);
    } catch (_) {}
  }

  // CardMirror only hands a plugin its api object when a command actually
  // runs — the registry keeps it in a private map, and there is no hook that
  // delivers it at load time. The ribbon button has to work on a cold session,
  // so stand in a shim built on the host bridge the preload already exposes on
  // window: the real api's flowApps/flowPost are thin wrappers over these.
  function fallbackApi() {
    const host = window.electronAPI || null;
    const read = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    };
    return {
      async flowApps() {
        return host && host.flowApps ? await host.flowApps() : [];
      },
      async flowPost(appId, route, body) {
        return host && host.flowPost
          ? await host.flowPost(appId, route, body)
          : { ok: false, error: 'unsupported' };
      },
      showToast: domToast,
      storage: {
        get(key) {
          return read()[key];
        },
        set(key, value) {
          const all = read();
          all[key] = value;
          try {
            localStorage.setItem(STORE_KEY, JSON.stringify(all));
          } catch (_) {}
        }
      },
      settings: {
        get(key) {
          const bag = read()[SETTINGS_KEY];
          if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return undefined;
          return bag[key];
        }
      }
    };
  }

  // A real api from a command run always wins; the shim only fills the gap.
  function ensureApi() {
    if (!pluginApi) pluginApi = fallbackApi();
    return pluginApi;
  }

  function roundLabel(round) {
    const r = String(round == null ? '' : round).trim();
    if (!r) return '';
    return /^\d+$/.test(r) ? 'Round ' + r : r;
  }

  function normalizeSide(side) {
    const s = String(side || '').trim().toUpperCase();
    if (s === 'A' || s === 'AFF' || s === '1') return 'AFF';
    if (s === 'N' || s === 'NEG' || s === '2') return 'NEG';
    return '';
  }

  function scrub(value) {
    return String(value == null ? '' : value)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function composeName(speech, round, flight) {
    const parts = [speech, scrub(round.tournament), roundLabel(round.round)];
    if (flight) parts.push('Flight ' + flight);
    const name = parts.filter(Boolean).join(' ');
    const opponent = scrub(round.opponent);
    return opponent ? name + ' vs ' + opponent : name;
  }

  function waitFor(selector, timeoutMs) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) {
        resolve(found);
        return;
      }
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs || 4000);
    });
  }

  function setNativeValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findNewSpeechButton() {
    const byId =
      document.getElementById('speech-new-btn') ||
      document.getElementById('new-speech-btn');
    if (byId) return byId;
    const byLabel = document.querySelector(
      'button[aria-label="New speech document"], button[title="New speech document"]'
    );
    if (byLabel) return byLabel;
    const stack = document.getElementById('speech-stack');
    if (stack) {
      const first = stack.querySelector('button');
      if (first) return first;
    }
    return null;
  }

  async function createSpeechDoc(name) {
    const button = findNewSpeechButton();
    if (!button) {
      await navigator.clipboard.writeText(name).catch(() => {});
      toast('New Speech button not found. Name copied: ' + name);
      return false;
    }

    button.click();
    const input = await waitFor('.pmd-text-prompt-input', 4000);
    if (!input) {
      await navigator.clipboard.writeText(name).catch(() => {});
      toast('Prompt did not open. Name copied: ' + name);
      return false;
    }

    setNativeValue(input, name);
    const dialog = input.closest('.pmd-route-dialog') || document;
    const ok = dialog.querySelector('.pmd-text-prompt-ok');
    if (ok) {
      ok.click();
    } else {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    }
    return true;
  }

  async function bridgeApp() {
    if (!pluginApi || typeof pluginApi.flowApps !== 'function') return null;
    try {
      const apps = await pluginApi.flowApps();
      return apps.find((a) => a.id === BRIDGE_APP) || null;
    } catch (_) {
      return null;
    }
  }

  function showLogin() {
    closeOverlay();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'tabroom-rounds-overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center';

      const dialog = document.createElement('div');
      dialog.style.cssText =
        'width:min(420px,calc(100vw - 32px));background:var(--pmd-c-bg,#fff);color:var(--pmd-c-text,#111);border:1px solid var(--pmd-c-border,#bbb);border-radius:10px;box-shadow:0 16px 50px rgba(0,0,0,.28);padding:18px;font:14px system-ui,sans-serif';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:6px';
      title.textContent = 'Sign in to Tabroom';
      dialog.appendChild(title);

      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;opacity:.7;margin-bottom:14px;line-height:1.4';
      note.textContent =
        'Your Tabroom login, sent to openCaselist. The password is stored in your Keychain and never leaves this machine.';
      dialog.appendChild(note);

      const fields = {};
      for (const [key, label, type] of [
        ['username', 'Tabroom email', 'email'],
        ['password', 'Password', 'password']
      ]) {
        const wrap = document.createElement('label');
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-bottom:10px';
        const span = document.createElement('span');
        span.style.cssText = 'font-size:12px;font-weight:600';
        span.textContent = label;
        const input = document.createElement('input');
        input.type = type;
        input.style.cssText =
          'box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--pmd-c-border,#bbb);border-radius:6px;background:var(--pmd-c-bg,#fff);color:inherit';
        wrap.appendChild(span);
        wrap.appendChild(input);
        dialog.appendChild(wrap);
        fields[key] = input;
      }

      const error = document.createElement('div');
      error.style.cssText = 'font-size:12px;color:#c0392b;min-height:16px;margin-bottom:6px';
      dialog.appendChild(error);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:6px';
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.style.cssText =
        'padding:8px 14px;border-radius:6px;border:1px solid var(--pmd-c-border,#aaa);cursor:pointer;background:transparent;color:inherit';
      const submit = document.createElement('button');
      submit.textContent = 'Sign in';
      submit.style.cssText =
        'padding:8px 14px;border-radius:6px;border:1px solid var(--pmd-c-border,#aaa);cursor:pointer;font-weight:600;background:transparent;color:inherit';
      actions.appendChild(cancel);
      actions.appendChild(submit);
      dialog.appendChild(actions);

      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(false));
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) finish(false);
      });

      const attempt = async () => {
        const username = fields.username.value.trim();
        const password = fields.password.value;
        if (!username || !password) {
          error.textContent = 'Enter both fields.';
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Signing in\u2026';
        error.textContent = '';
        const res = await pluginApi.flowPost(BRIDGE_APP, '/login', {
          username,
          password
        });
        submit.disabled = false;
        submit.textContent = 'Sign in';
        if (!res.ok) {
          error.textContent = 'Bridge error: ' + res.error;
          return;
        }
        const body = res.body || {};
        if (!body.ok) {
          error.textContent = body.error || 'Sign in failed.';
          return;
        }
        finish(true);
      };

      submit.addEventListener('click', () => void attempt());
      for (const input of Object.values(fields)) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void attempt();
        });
      }
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', esc);
          finish(false);
        }
      });

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
      setTimeout(() => fields.username.focus(), 30);
    });
  }

  const RELEASES_URL =
    'https://github.com/SahithMangu/CardMirror-Tournament-SpeechDoc-Plugin/releases/latest';

  function showHelperNeeded() {
    closeOverlay();
    const overlay = document.createElement('div');
    overlay.id = 'tabroom-rounds-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'width:min(460px,calc(100vw - 32px));background:var(--pmd-c-bg,#fff);color:var(--pmd-c-text,#111);border:1px solid var(--pmd-c-border,#bbb);border-radius:10px;box-shadow:0 16px 50px rgba(0,0,0,.28);padding:18px;font:14px system-ui,sans-serif';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:8px';
    title.textContent = 'One more piece to install';
    dialog.appendChild(title);

    const body = document.createElement('div');
    body.style.cssText = 'font-size:13px;line-height:1.5;opacity:.85;margin-bottom:16px';
    body.textContent =
      'Tabroom Rounds needs a small background helper to reach openCaselist, because CardMirror itself is not allowed to send the login cookie. Download TabroomBridge.pkg from the releases page and open it, then try again.';
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
    const close = document.createElement('button');
    close.textContent = 'Later';
    close.style.cssText =
      'padding:8px 14px;border-radius:6px;border:1px solid var(--pmd-c-border,#aaa);cursor:pointer;background:transparent;color:inherit';
    close.addEventListener('click', closeOverlay);
    const open = document.createElement('button');
    open.textContent = 'Open releases page';
    open.style.cssText =
      'padding:8px 14px;border-radius:6px;border:1px solid var(--pmd-c-border,#aaa);cursor:pointer;font-weight:600;background:transparent;color:inherit';
    open.addEventListener('click', () => {
      window.open(RELEASES_URL, '_blank');
      closeOverlay();
    });
    actions.appendChild(close);
    actions.appendChild(open);
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeOverlay();
    });
    document.body.appendChild(overlay);
  }

  const MIN_HELPER_VERSION = '1.0.0';

  function versionBelow(actual, required) {
    const parse = (v) =>
      String(v || '0')
        .replace(/^v/, '')
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const a = parse(actual);
    const b = parse(required);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0;
      const y = b[i] || 0;
      if (x !== y) return x < y;
    }
    return false;
  }

  function confirmDialog(title, message, confirmLabel) {
    closeOverlay();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.id = 'tabroom-rounds-overlay';
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center';
      const dialog = document.createElement('div');
      dialog.style.cssText =
        'width:min(460px,calc(100vw - 32px));background:var(--pmd-c-bg,#fff);color:var(--pmd-c-text,#111);border:1px solid var(--pmd-c-border,#bbb);border-radius:10px;box-shadow:0 16px 50px rgba(0,0,0,.28);padding:18px;font:14px system-ui,sans-serif';

      const h = document.createElement('div');
      h.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:8px';
      h.textContent = title;
      dialog.appendChild(h);

      const body = document.createElement('div');
      body.style.cssText = 'font-size:13px;line-height:1.5;opacity:.85;margin-bottom:16px';
      body.textContent = message;
      dialog.appendChild(body);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
      const no = document.createElement('button');
      no.textContent = 'Not now';
      no.style.cssText =
        'padding:8px 14px;border-radius:6px;border:1px solid var(--pmd-c-border,#aaa);cursor:pointer;background:transparent;color:inherit';
      const yes = document.createElement('button');
      yes.textContent = confirmLabel;
      yes.style.cssText =
        'padding:8px 14px;border-radius:6px;border:1px solid var(--pmd-c-border,#aaa);cursor:pointer;font-weight:600;background:transparent;color:inherit';
      const finish = (v) => {
        overlay.remove();
        resolve(v);
      };
      no.addEventListener('click', () => finish(false));
      yes.addEventListener('click', () => finish(true));
      actions.appendChild(no);
      actions.appendChild(yes);
      dialog.appendChild(actions);
      overlay.appendChild(dialog);
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) finish(false);
      });
      document.body.appendChild(overlay);
    });
  }

  async function runSelfUpdate() {
    toast('Updating the helper\u2026');
    const res = await pluginApi.flowPost(BRIDGE_APP, '/self-update', {});
    if (!res.ok) {
      toast('Update failed: ' + res.error);
      return false;
    }
    const body = res.body || {};
    if (!body.ok) {
      toast('Update failed: ' + body.error);
      return false;
    }
    await new Promise((r) => setTimeout(r, 3000));
    toast('Helper updated to ' + body.version + '.');
    return true;
  }

  async function ensureHelperCurrent(app) {
    const version = app.appVersion || '0';
    if (versionBelow(version, MIN_HELPER_VERSION)) {
      const go = await confirmDialog(
        'The Tabroom helper needs updating',
        'This version of the plugin needs helper ' +
          MIN_HELPER_VERSION +
          ' or newer, and you have ' +
          version +
          '. It can update itself now.',
        'Update now'
      );
      if (!go) return false;
      return runSelfUpdate();
    }
    return true;
  }

  function roundTime(round) {
    const raw = round && round.start_time;
    if (!raw) return null;
    let value = String(raw).trim();
    if (/^\d+$/.test(value)) {
      const n = parseInt(value, 10);
      return new Date(n < 1e11 ? n * 1000 : n);
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) value = value.replace(' ', 'T');
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function settingNumber(key, fallback) {
    try {
      const v = pluginApi.settings.get(key);
      return typeof v === 'number' && isFinite(v) ? v : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function settingBool(key, fallback) {
    try {
      const v = pluginApi && pluginApi.settings ? pluginApi.settings.get(key) : undefined;
      return typeof v === 'boolean' ? v : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function prune(rounds, windowHours) {
    const now = Date.now();
    const cutoff = windowHours > 0 ? now - windowHours * 3600 * 1000 : null;
    const dated = [];
    const undated = [];
    for (const round of rounds) {
      const when = roundTime(round);
      if (!when) {
        undated.push(round);
        continue;
      }
      if (cutoff !== null && when.getTime() < cutoff) continue;
      dated.push({ round, at: when.getTime() });
    }
    dated.sort((a, b) => a.at - b.at);
    const ordered = dated.map((d) => d.round);
    return cutoff === null ? ordered.concat(undated) : ordered;
  }

  function describeAge(round) {
    const when = roundTime(round);
    if (!when) return '';
    const diff = when.getTime() - Date.now();
    const hours = Math.round(Math.abs(diff) / 3600000);
    if (hours < 1) return diff >= 0 ? 'starting soon' : 'just now';
    if (hours < 24) return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
    const days = Math.round(hours / 24);
    return diff >= 0 ? `in ${days}d` : `${days}d ago`;
  }

  async function fetchRounds(force, current, allowLogin) {
    const app = await bridgeApp();
    if (!app) {
      showHelperNeeded();
      return null;
    }
    if (!app.running) {
      toast('The Tabroom helper is installed but not running. Restarting your Mac will start it.');
      return null;
    }
    if (!(await ensureHelperCurrent(app))) return null;
    const res = await pluginApi.flowPost(BRIDGE_APP, '/rounds', {
      current: current !== false,
      force: !!force
    });
    if (!res.ok) {
      toast('Bridge error: ' + res.error);
      return null;
    }
    const body = res.body || {};
    if (!body.ok) {
      if (body.error === 'not-logged-in') {
        if (allowLogin === false) {
          toast('Not signed in.');
          return null;
        }
        const signedIn = await showLogin();
        if (!signedIn) return null;
        return fetchRounds(force, current, false);
      } else if (body.error === 'rate-limited' || body.error === 'throttled') {
        toast('Slow down — retry in ' + body.retryAfter + 's.');
      } else {
        toast('openCaselist error: ' + body.error);
      }
      return null;
    }
    if (body.stale) {
      toast('Showing cached rounds; refresh available in ' + body.retryAfter + 's.');
    }
    return body.rounds || [];
  }

  function closeOverlay() {
    const existing = document.getElementById('tabroom-rounds-overlay');
    if (existing) existing.remove();
  }

  function showPicker(rounds, heading, windowHours) {
    closeOverlay();
    if (!rounds.length) {
      toast(
        windowHours > 0
          ? 'No rounds in the last ' + windowHours + ' hours.'
          : 'No rounds found.'
      );
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'tabroom-rounds-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'width:min(620px,calc(100vw - 32px));max-height:80vh;overflow:auto;background:var(--pmd-c-bg,#fff);color:var(--pmd-c-text,#111);border:1px solid var(--pmd-c-border,#bbb);border-radius:10px;box-shadow:0 16px 50px rgba(0,0,0,.28);padding:16px;font:14px system-ui,sans-serif';

    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;justify-content:space-between;align-items:center;font-size:17px;margin-bottom:12px';
    const title = document.createElement('strong');
    title.textContent = heading || 'Live rounds';
    header.appendChild(title);
    const close = document.createElement('button');
    close.textContent = '\u00d7';
    close.style.cssText =
      'border:0;background:transparent;font-size:24px;cursor:pointer;color:inherit';
    close.addEventListener('click', closeOverlay);
    header.appendChild(close);
    dialog.appendChild(header);

    const flightRow = document.createElement('div');
    flightRow.style.cssText =
      'display:flex;gap:8px;align-items:center;margin-bottom:14px;font-size:13px';
    flightRow.appendChild(document.createTextNode('Flight:'));
    let flight = pluginApi.storage.get('flight') || '';
    const flightButtons = [];
    for (const option of ['', '1', '2']) {
      const b = document.createElement('button');
      b.textContent = option === '' ? 'None' : option;
      b.style.cssText =
        'padding:4px 12px;border-radius:6px;border:1px solid var(--pmd-c-border,#bbb);cursor:pointer;background:transparent;color:inherit';
      b.addEventListener('click', () => {
        flight = option;
        pluginApi.storage.set('flight', option);
        for (const sib of flightButtons) {
          sib.style.background = 'transparent';
          sib.style.color = 'inherit';
        }
        b.style.background = '#2e8b57';
        b.style.color = '#fff';
      });
      if (option === flight) {
        b.style.background = '#2e8b57';
        b.style.color = '#fff';
      }
      flightButtons.push(b);
      flightRow.appendChild(b);
    }
    dialog.appendChild(flightRow);

    for (const round of rounds) {
      const side = normalizeSide(round.side);
      const speeches =
        side === 'AFF'
          ? AFF_SPEECHES
          : side === 'NEG'
            ? NEG_SPEECHES
            : AFF_SPEECHES.concat(NEG_SPEECHES);

      const block = document.createElement('div');
      block.style.cssText =
        'padding:10px;border:1px solid var(--pmd-c-border,#bbb);border-radius:8px;margin-bottom:10px';

      const line = document.createElement('div');
      line.style.cssText = 'font-weight:600;margin-bottom:2px';
      line.textContent = [
        scrub(round.tournament),
        roundLabel(round.round),
        side,
        round.opponent ? 'vs ' + scrub(round.opponent) : ''
      ]
        .filter(Boolean)
        .join(' ');
      block.appendChild(line);

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:12px;opacity:.7;margin-bottom:8px';
      meta.textContent = [
        round.judge ? 'Judge: ' + round.judge : '',
        describeAge(round)
      ]
        .filter(Boolean)
        .join('  \u00b7  ');
      block.appendChild(meta);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
      for (const speech of speeches) {
        const b = document.createElement('button');
        b.textContent = speech;
        b.style.cssText =
          'min-width:46px;padding:6px 10px;border-radius:6px;border:1px solid var(--pmd-c-border,#bbb);cursor:pointer;background:transparent;color:inherit';
        b.addEventListener('click', () => {
          void select(speech, round, flight);
        });
        row.appendChild(b);
      }
      block.appendChild(row);
      dialog.appendChild(block);
    }

    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) closeOverlay();
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') {
        closeOverlay();
        document.removeEventListener('keydown', esc);
      }
    });
    document.body.appendChild(overlay);
  }

  async function select(speech, round, flight) {
    const name = composeName(speech, round, flight);
    pluginApi.storage.set('lastRound', {
      speech,
      flight,
      tournament: round.tournament,
      round: round.round,
      side: normalizeSide(round.side),
      opponent: round.opponent,
      judge: round.judge,
      share: round.share,
      name,
      at: Date.now()
    });
    closeOverlay();
    await createSpeechDoc(name);
  }

  async function openRoundPicker() {
    ensureApi();
    const rounds = await fetchRounds(false, true, true);
    if (!rounds) return;
    const hours = settingNumber('recentWindowHours', 18);
    showPicker(prune(rounds, hours), 'Current rounds', hours);
  }

  // --- Ribbon button -------------------------------------------------------
  // There is no ribbon API for plugins, so the button is injected into the
  // ribbon's own markup. It goes in a stack of its own rather than inside
  // #speech-stack, because CardMirror hides that stack by id in single-doc
  // mode (`body:not(.pmd-multi-doc):not(.pmd-multi-window) #speech-stack`)
  // and picking a round is useful before a second pane exists.
  const STACK_ID = 'tabroom-stack';
  const BUTTON_ID = 'tabroom-round-btn';

  async function onButtonClick() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.disabled = true;
    try {
      await openRoundPicker();
    } catch (e) {
      console.error('[Tabroom Rounds] ribbon button failed', e);
      toast('Tabroom: ' + ((e && e.message) || 'something went wrong'));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function buildButton() {
    const stack = document.createElement('div');
    stack.id = STACK_ID;
    stack.className = 'ribbon-button-stack ribbon-speech-stack';
    stack.setAttribute('role', 'group');
    stack.setAttribute('aria-label', 'Tabroom');

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'New speech doc from a Tabroom round';
    btn.setAttribute('aria-label', 'New speech doc from a Tabroom round');

    const icon = document.createElement('span');
    icon.className = 'pmd-icon pmd-icon-trophy';
    icon.setAttribute('aria-hidden', 'true');

    btn.appendChild(icon);
    btn.addEventListener('click', onButtonClick);
    stack.appendChild(btn);
    return stack;
  }

  function mountButton() {
    if (!document.body) return false;
    if (!settingBool('showRibbonButton', true)) {
      const existing = document.getElementById(STACK_ID);
      if (existing) existing.remove();
      return true;
    }
    if (document.getElementById(BUTTON_ID)) return true;
    const anchor =
      document.getElementById('speech-stack') ||
      document.getElementById('quickcards-stack');
    if (!anchor || !anchor.parentNode) return false;
    anchor.parentNode.insertBefore(buildButton(), anchor.nextSibling);
    return true;
  }

  function watchRibbon() {
    // The plugin loads before the ribbon exists, and CardMirror rebuilds the
    // ribbon on layout changes, so poll at boot and re-mount on remount.
    let tries = 0;
    const timer = setInterval(() => {
      if (mountButton() || ++tries > 150) clearInterval(timer);
    }, 200);

    const observer = new MutationObserver(() => {
      mountButton();
    });
    const start = () => observer.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  const def = {
    id: PLUGIN_ID,
    name: 'Tabroom Rounds',
    apiVersion: 1,
    settings: [
      {
        key: 'showRibbonButton',
        label: 'Show the Tabroom button in the ribbon',
        type: 'boolean',
        default: true,
        description:
          'Adds a trophy button next to the speech-doc buttons that opens the round picker directly.'
      },
      {
        key: 'recentWindowHours',
        label: 'Hide rounds older than (hours)',
        type: 'number',
        default: 18,
        description:
          'Rounds that started longer ago than this are left out of the round picker. Set to 0 to show everything Tabroom returns.'
      },
      {
        key: 'historyLimit',
        label: 'Rounds shown in history',
        type: 'number',
        default: 25,
        description: 'How many past rounds "All Rounds This Season" lists, newest first.'
      }
    ],
    commands: [
      {
        id: PLUGIN_ID + '.pick',
        label: 'Tabroom: New Speech Doc From Round',
        keywords: ['tabroom', 'round', 'speech', 'pairing', 'tournament'],
        defaultKey: '',
        run: async (api) => {
          pluginApi = api;
          await openRoundPicker();
        }
      },
      {
        id: PLUGIN_ID + '.refresh',
        label: 'Tabroom: Refresh Rounds',
        keywords: ['tabroom', 'refresh', 'rounds'],
        defaultKey: '',
        run: async (api) => {
          pluginApi = api;
          const rounds = await fetchRounds(true, true, true);
          if (!rounds) return;
          const hours = settingNumber('recentWindowHours', 18);
          showPicker(prune(rounds, hours), 'Current rounds', hours);
        }
      },
      {
        id: PLUGIN_ID + '.signin',
        label: 'Tabroom: Sign In',
        keywords: ['tabroom', 'sign in', 'login', 'account'],
        defaultKey: '',
        run: async (api) => {
          pluginApi = api;
          const app = await bridgeApp();
          if (!app) {
            showHelperNeeded();
            return;
          }
          if (!app.running) {
            toast('The Tabroom helper is installed but not running.');
            return;
          }
          const ok = await showLogin();
          if (ok) toast('Signed in to Tabroom.');
        }
      },
      {
        id: PLUGIN_ID + '.updatehelper',
        label: 'Tabroom: Update Helper',
        keywords: ['tabroom', 'update', 'helper', 'bridge', 'version'],
        defaultKey: '',
        run: async (api) => {
          pluginApi = api;
          const app = await bridgeApp();
          if (!app) {
            showHelperNeeded();
            return;
          }
          if (!app.running) {
            toast('The Tabroom helper is installed but not running.');
            return;
          }
          const res = await pluginApi.flowPost(BRIDGE_APP, '/check-update', { force: true });
          if (!res.ok) {
            toast('Bridge error: ' + res.error);
            return;
          }
          const body = res.body || {};
          if (!body.updateAvailable) {
            toast('Helper is up to date (' + body.version + ').');
            return;
          }
          const go = await confirmDialog(
            'Helper update available',
            'Version ' + body.latestVersion + ' is available. You have ' + body.version + '.',
            'Update now'
          );
          if (go) await runSelfUpdate();
        }
      },
      {
        id: PLUGIN_ID + '.signout',
        label: 'Tabroom: Sign Out',
        keywords: ['tabroom', 'sign out', 'logout', 'forget'],
        defaultKey: '',
        run: async (api) => {
          pluginApi = api;
          const res = await pluginApi.flowPost(BRIDGE_APP, '/logout', {});
          toast(res.ok ? 'Signed out and credentials cleared.' : 'Bridge error: ' + res.error);
        }
      },
      {
        id: PLUGIN_ID + '.all',
        label: 'Tabroom: All Rounds This Season',
        keywords: ['tabroom', 'history', 'all rounds', 'season'],
        defaultKey: '',
        run: async (api) => {
          pluginApi = api;
          const rounds = await fetchRounds(true, false, true);
          if (!rounds) return;
          const limit = settingNumber('historyLimit', 25);
          const ordered = prune(rounds, 0).reverse().slice(0, limit).reverse();
          showPicker(ordered, 'Recent rounds', 0);
        }
      }
    ]
  };

  try {
    window.__registerCardMirrorPlugin?.(def);
  } catch (e) {
    console.error('[Tabroom Rounds] registration failed', e);
  }

  try {
    watchRibbon();
  } catch (e) {
    console.error('[Tabroom Rounds] ribbon button failed to mount', e);
  }
})();
