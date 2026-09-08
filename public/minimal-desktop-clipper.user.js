// ==UserScript==
// @name         Minimal Desktop 网页剪藏
// @namespace    https://github.com/qq5855144/Minimal-Desktop
// @version      1.3.0
// @description  使用可拖动的 U 形悬浮菜单打开 Minimal Desktop，或将当前网页添加到桌面、书签。
// @author       Minimal Desktop
// @match        http://*/*
// @match        https://*/*
// @exclude      https://qq5855144.github.io/Minimal-Desktop/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const DESKTOP_URL = 'https://qq5855144.github.io/Minimal-Desktop/';
  const POSITION_KEY = 'minimal-desktop-clipper-position-v1';
  const IDLE_DELAY = 2000;
  const BUTTON_EDGE_MARGIN = 20;
  const MAX_URL_LENGTH = 8192;
  const MAX_ICON_LENGTH = 4096;
  const rootUrl = new URL(DESKTOP_URL);
  if (location.origin === rootUrl.origin && location.pathname.startsWith(rootUrl.pathname)) return;
  if (!/^https?:$/.test(location.protocol) || location.href.length > MAX_URL_LENGTH) return;

  const readValue = (key, fallback) => {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch (_) {}
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  };

  const writeValue = (key, value) => {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  };

  const extractSiteName = (raw) => {
    const trimmed = raw.trim();
    const firstSeparator = trimmed.match(/^(.+?)\s*[-|–—,·\/]\s*.+$/);
    let name = firstSeparator ? firstSeparator[1].trim() : trimmed;
    const decoratedSuffix = name.match(/^(.+?)\s+(?=[(\[{<（【《『「'"@#$%^&*~`！？。，、；：☆★♪♫♬♩©®™°•])/u);
    if (decoratedSuffix) name = decoratedSuffix[1].trim();
    return name.length > 64 ? `${name.slice(0, 63)}…` : name;
  };

  const findFavicon = () => {
    const links = [...document.querySelectorAll('link[rel~="icon"]')];
    const href = links.at(-1)?.href || `${location.origin}/favicon.ico`;
    return /^https?:\/\//i.test(href) && href.length <= MAX_ICON_LENGTH ? href : '';
  };

  const host = document.createElement('div');
  host.id = 'minimal-desktop-clipper-host';
  host.style.cssText = 'all:initial;position:fixed;right:0;top:50%;z-index:2147483647;width:232px;height:40px;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      .clipper{all:initial;pointer-events:auto;position:absolute;inset:0;width:232px;height:40px;padding:3px 5px 3px 4px;box-sizing:border-box;border-radius:20px 0 0 20px;background:rgba(255,255,255,.18);backdrop-filter:blur(16px) saturate(180%);-webkit-backdrop-filter:blur(16px) saturate(180%);box-shadow:-2px 0 18px rgba(0,0,0,.12),inset 0 1px 0 rgba(255,255,255,.5);display:flex;align-items:center;gap:4px;touch-action:none;user-select:none;-webkit-tap-highlight-color:transparent;transform:translateX(calc(100% - 10px));transition:transform .4s cubic-bezier(.22,1,.36,1),background .3s,box-shadow .3s}
      .clipper.extend{transform:translateX(0);background:rgba(255,255,255,.32);box-shadow:-3px 0 22px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.6)}
      button{all:initial;box-sizing:border-box;cursor:pointer;font:600 12px/1 system-ui,-apple-system,sans-serif;color:#075b55;-webkit-tap-highlight-color:transparent}
      .drag-handle{width:34px;height:34px;flex:0 0 34px;border-radius:50%;background:linear-gradient(135deg,#00e5c0 0%,#00b4d8 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,200,180,.5),0 1px 3px rgba(0,0,0,.2);transition:box-shadow .3s,transform .3s;overflow:hidden}
      .clipper.extend .drag-handle{box-shadow:0 4px 18px rgba(0,200,180,.65),0 2px 5px rgba(0,0,0,.22)}
      .drag-handle:active,.action:active{transform:scale(.94)}
      .action{height:30px;padding:0 8px;border-radius:15px;background:rgba(255,255,255,.58);display:flex;align-items:center;justify-content:center;white-space:nowrap;opacity:0;pointer-events:none;transform:translateX(8px);transition:opacity .2s,transform .3s,background .2s}
      .clipper.extend .action{opacity:1;pointer-events:auto;transform:translateX(0)}
      .action:hover,.action:focus-visible{background:rgba(255,255,255,.92);outline:2px solid rgba(0,180,170,.35);outline-offset:-2px}
      img{display:block;width:26px;height:26px;border-radius:50%;object-fit:cover;background:#fff}
      .fallback{display:none;width:26px;height:26px;color:#fff;place-items:center;font:20px/1 system-ui;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))}
      @media (prefers-reduced-motion:reduce){.clipper,.drag-handle,.action{transition:none}}
    </style>
    <div class="clipper extend" role="group" aria-label="Minimal Desktop 网页剪藏">
      <button type="button" class="drag-handle" aria-label="展开剪藏菜单或拖动调整位置" title="拖动调整位置"><img alt="" referrerpolicy="no-referrer"><span class="fallback" aria-hidden="true">✦</span></button>
      <button type="button" class="action" data-action="home">主页</button>
      <button type="button" class="action" data-target="desktop">桌面</button>
      <button type="button" class="action" data-target="bookmarks">书签</button>
    </div>`;

  const panel = shadow.querySelector('.clipper');
  const dragHandle = shadow.querySelector('.drag-handle');
  const image = shadow.querySelector('img');
  const fallback = shadow.querySelector('.fallback');
  const favicon = findFavicon();
  const showFallback = () => { image.style.display = 'none'; fallback.style.display = 'grid'; };
  if (favicon) {
    image.addEventListener('error', showFallback, { once: true });
    image.src = favicon;
  } else showFallback();

  const clampRatio = (value) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  let positionRatio = clampRatio(Number(readValue(POSITION_KEY, 0.5)));
  const applyPosition = () => {
    const minY = Math.min(BUTTON_EDGE_MARGIN, window.innerHeight / 2);
    const maxY = Math.max(minY, window.innerHeight - BUTTON_EDGE_MARGIN);
    const centerY = Math.min(maxY, Math.max(minY, positionRatio * window.innerHeight));
    host.style.transform = `translateY(${centerY - window.innerHeight / 2 - 20}px)`;
  };
  applyPosition();
  window.addEventListener('resize', applyPosition, { passive: true });

  let idleTimer;
  let isClipperExtended = true;
  const extend = () => {
    if (!isClipperExtended) {
      isClipperExtended = true;
      panel.classList.add('extend');
    }
    clearTimeout(idleTimer);
  };
  const retract = () => {
    isClipperExtended = false;
    panel.classList.remove('extend');
  };
  const scheduleRetract = (delay = IDLE_DELAY) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(retract, delay);
  };
  panel.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') extend();
  });
  panel.addEventListener('pointerleave', () => scheduleRetract());
  panel.addEventListener('focusin', extend);

  let startY = 0;
  let startCenterY = 0;
  let dragging = false;
  let suppressClick = false;
  let canActivateThisClick = false;
  panel.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    canActivateThisClick = isClipperExtended;
    extend();
    if (!event.target.closest?.('.drag-handle')) return;
    startY = event.clientY;
    startCenterY = positionRatio * window.innerHeight;
    dragging = false;
    panel.setPointerCapture?.(event.pointerId);
  });
  panel.addEventListener('pointermove', (event) => {
    if (!panel.hasPointerCapture?.(event.pointerId)) return;
    const delta = event.clientY - startY;
    if (Math.abs(delta) > 5) dragging = true;
    if (!dragging) return;
    const minY = Math.min(BUTTON_EDGE_MARGIN, window.innerHeight / 2);
    const maxY = Math.max(minY, window.innerHeight - BUTTON_EDGE_MARGIN);
    const centerY = Math.min(maxY, Math.max(minY, startCenterY + delta));
    positionRatio = window.innerHeight ? centerY / window.innerHeight : 0.5;
    applyPosition();
  });
  const finishDrag = (event) => {
    if (!panel.hasPointerCapture?.(event.pointerId)) return;
    panel.releasePointerCapture?.(event.pointerId);
    if (dragging) {
      writeValue(POSITION_KEY, positionRatio);
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
    dragging = false;
    scheduleRetract();
  };
  panel.addEventListener('pointerup', finishDrag);
  panel.addEventListener('pointercancel', finishDrag);

  const confirmExtension = () => {
    extend();
    scheduleRetract(4000);
  };
  const openHome = () => {
    window.open(DESKTOP_URL, '_blank', 'noopener,noreferrer');
    retract();
  };
  const openClip = (target) => {
    const payload = {
      url: location.href,
      title: extractSiteName(document.title) || location.hostname,
      favicon: findFavicon() || undefined,
      target,
    };
    const destination = `${DESKTOP_URL}#clip=${encodeURIComponent(JSON.stringify(payload))}`;
    window.open(destination, '_blank', 'noopener,noreferrer');
    retract();
  };

  panel.addEventListener('click', (event) => {
    if (suppressClick) return;
    const homeButton = event.target.closest?.('[data-action="home"]');
    const targetButton = event.target.closest?.('[data-target]');
    const pointerActivation = event.detail !== 0;
    if (!isClipperExtended || (pointerActivation && !canActivateThisClick)) {
      confirmExtension();
      return;
    }
    if (homeButton) openHome();
    else if (targetButton) openClip(targetButton.dataset.target);
    else scheduleRetract(4000);
  });
  dragHandle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') extend();
  });

  (document.body || document.documentElement).append(host);
  scheduleRetract(3000);
})();
