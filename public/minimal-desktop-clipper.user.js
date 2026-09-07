// ==UserScript==
// @name         Minimal Desktop 网页剪藏
// @namespace    https://github.com/qq5855144/Minimal-Desktop
// @version      1.0.0
// @description  在网页右下角显示 favicon 剪藏按钮，闲置时自动贴边。
// @author       Minimal Desktop
// @match        http://*/*
// @match        https://*/*
// @exclude      https://qq5855144.github.io/Minimal-Desktop/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const DESKTOP_URL = 'https://qq5855144.github.io/Minimal-Desktop/';
  const IDLE_DELAY = 1800;
  const MAX_URL_LENGTH = 8192;
  const MAX_ICON_LENGTH = 4096;
  const rootUrl = new URL(DESKTOP_URL);
  if (location.origin === rootUrl.origin && location.pathname.startsWith(rootUrl.pathname)) return;
  if (!/^https?:$/.test(location.protocol) || location.href.length > MAX_URL_LENGTH) return;

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
  host.style.cssText = 'all:initial;position:fixed;right:0;bottom:max(24px,env(safe-area-inset-bottom));z-index:2147483647;width:56px;height:56px;pointer-events:none';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      button{pointer-events:auto;position:absolute;right:8px;bottom:0;width:48px;height:48px;padding:7px;border:1px solid rgba(255,255,255,.72);border-radius:16px;background:rgba(25,30,45,.78);box-shadow:0 8px 28px rgba(0,0,0,.28);backdrop-filter:blur(12px);cursor:pointer;transition:transform .28s ease,box-shadow .2s ease,background .2s ease;overflow:hidden}
      button.tucked{transform:translateX(42px)}
      button:hover,button:focus-visible{transform:translateX(0);background:rgba(25,30,45,.94);box-shadow:0 10px 32px rgba(0,0,0,.36);outline:2px solid rgba(96,165,250,.9);outline-offset:2px}
      img{display:block;width:32px;height:32px;border-radius:9px;object-fit:cover;background:#fff}
      .fallback{display:none;width:32px;height:32px;color:white;place-items:center;font:22px/1 system-ui}
      @media (prefers-reduced-motion:reduce){button{transition:none}}
    </style>
    <button type="button" aria-label="剪藏到 Minimal Desktop" title="剪藏到 Minimal Desktop">
      <img alt="" referrerpolicy="no-referrer"><span class="fallback" aria-hidden="true">✦</span>
    </button>`;

  const button = shadow.querySelector('button');
  const image = shadow.querySelector('img');
  const fallback = shadow.querySelector('.fallback');
  const favicon = findFavicon();
  const showFallback = () => { image.style.display = 'none'; fallback.style.display = 'grid'; };
  if (favicon) {
    image.addEventListener('error', showFallback, { once: true });
    image.src = favicon;
  } else showFallback();

  let idleTimer;
  const wake = () => {
    button.classList.remove('tucked');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => button.classList.add('tucked'), IDLE_DELAY);
  };
  button.addEventListener('pointerenter', wake);
  button.addEventListener('pointerleave', wake);
  button.addEventListener('focus', wake);
  button.addEventListener('click', () => {
    const payload = {
      url: location.href,
      title: extractSiteName(document.title) || location.hostname,
      favicon: findFavicon() || undefined,
      target: 'desktop',
    };
    const destination = `${DESKTOP_URL}#clip=${encodeURIComponent(JSON.stringify(payload))}`;
    window.open(destination, '_blank', 'noopener,noreferrer');
    wake();
  });

  (document.body || document.documentElement).append(host);
  wake();
})();
