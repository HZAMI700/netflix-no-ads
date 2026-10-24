/**
 * ==============================================================================
 * StreamShield - Free Cloudflare Worker Reverse Proxy
 * Removes pop-under/popup ads from embedded video players WITHOUT iframe sandbox
 * ==============================================================================
 */

// Target origin to proxy
export const TARGET = 'https://streamnaro.online';

// Referer header sent with requests
export const REFERER = TARGET + '/';

// Blocklist substrings for script URLs to remove via HTMLRewriter
export const SCRIPT_BLOCKLIST = [
  'pop',
  'ads',
  'adsterra',
  'propeller',
  'monetag',
  'clickadu',
  'hilltopads',
  'exoclick',
  'adx',
  'doubleclick',
  'trafficjunky',
  'popads',
  'onclick',
  'tsyndicate',
  'juicyads',
  'popcash',
  'admaven'
];

// Path prefix used to proxy nested external iframes
const PROXY_PREFIX = '/__p/';

/**
 * Builds the inline shield script injected into the <head> of all proxied HTML pages.
 * Handles:
 * - Overriding window.open with a fake window object
 * - Intercepting external anchor clicks & a[target=_blank]
 * - Intercepting forms with target=_blank
 * - Blocking top-level location.assign / location.replace hijacks
 * - Removing dynamically created full-screen transparent overlays via MutationObserver
 */
function buildShieldScript(targetOrigin) {
  return `(function() {
  'use strict';
  // Fake window object so ad scripts think the popup opened successfully
  var fakeWindow = {
    closed: false,
    focus: function() {},
    blur: function() {},
    close: function() { this.closed = true; },
    postMessage: function() {},
    location: { href: '' },
    document: { write: function() {}, close: function() {} }
  };

  function fakeOpen() {
    console.warn('[StreamShield] Blocked window.open');
    return fakeWindow;
  }

  try {
    Object.defineProperty(window, 'open', {
      value: fakeOpen,
      writable: false,
      configurable: false
    });
  } catch (e) {
    try { window.open = fakeOpen; } catch (err) {}
  }

  try {
    Object.defineProperty(self, 'open', {
      value: fakeOpen,
      writable: false,
      configurable: false
    });
  } catch (e) {
    try { self.open = fakeOpen; } catch (err) {}
  }

  try {
    if (typeof globalThis !== 'undefined') {
      Object.defineProperty(globalThis, 'open', {
        value: fakeOpen,
        writable: false,
        configurable: false
      });
    }
  } catch (e) {}

  var TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
  var targetHostname = '';
  try {
    targetHostname = new URL(TARGET_ORIGIN).hostname;
  } catch (e) {}

  // Blocks clicks (capture phase) on a[target=_blank] and on external anchors
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.tagName === 'A' || el.tagName === 'AREA') {
        var href = el.getAttribute('href') || '';
        var targetAttr = (el.getAttribute('target') || '').toLowerCase();

        // 1. Block target=_blank / _top / _parent
        if (targetAttr === '_blank' || targetAttr === '_top' || targetAttr === '_parent') {
          e.preventDefault();
          e.stopImmediatePropagation();
          console.warn('[StreamShield] Blocked click with target=' + targetAttr, href);
          return;
        }

        // 2. Block external domains
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            var resolved = new URL(href, window.location.href);
            var isInternal = (
              resolved.hostname === window.location.hostname ||
              (targetHostname && resolved.hostname === targetHostname) ||
              resolved.origin === window.location.origin
            );
            if (!isInternal) {
              e.preventDefault();
              e.stopImmediatePropagation();
              console.warn('[StreamShield] Blocked click to external URL:', resolved.href);
              return;
            }
          } catch (err) {}
        }
      }
      el = el.parentElement;
    }
  }, true);

  // Block middle-click ad triggers
  document.addEventListener('auxclick', function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // Blocks form submissions with target=_blank
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.tagName === 'FORM') {
      var targetAttr = (form.getAttribute('target') || '').toLowerCase();
      if (targetAttr === '_blank' || targetAttr === '_top' || targetAttr === '_parent') {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.warn('[StreamShield] Blocked form submit with target=' + targetAttr);
        return;
      }
    }
  }, true);

  try {
    var origFormSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
      var targetAttr = (this.getAttribute('target') || '').toLowerCase();
      if (targetAttr === '_blank' || targetAttr === '_top' || targetAttr === '_parent') {
        console.warn('[StreamShield] Blocked programmatic form.submit with target=' + targetAttr);
        return;
      }
      return origFormSubmit.apply(this, arguments);
    };
  } catch (e) {}

  // Prevents top-level navigation hijacks: wrap location.assign / location.replace
  try {
    var origAssign = Location.prototype.assign;
    Location.prototype.assign = function(url) {
      try {
        var resolved = new URL(url, window.location.href);
        if (resolved.hostname !== window.location.hostname && (!targetHostname || resolved.hostname !== targetHostname)) {
          console.warn('[StreamShield] Blocked location.assign to external domain:', url);
          return;
        }
      } catch (e) {}
      return origAssign.call(this, url);
    };
  } catch (e) {}

  try {
    var origReplace = Location.prototype.replace;
    Location.prototype.replace = function(url) {
      try {
        var resolved = new URL(url, window.location.href);
        if (resolved.hostname !== window.location.hostname && (!targetHostname || resolved.hostname !== targetHostname)) {
          console.warn('[StreamShield] Blocked location.replace to external domain:', url);
          return;
        }
      } catch (e) {}
      return origReplace.call(this, url);
    };
  } catch (e) {}

  // MutationObserver to remove dynamically injected full-screen transparent overlays
  function isOverlayAd(el) {
    if (!el || el.nodeType !== 1) return false;
    // Never remove video elements or elements containing a video
    if (el.tagName === 'VIDEO' || el.querySelector('video')) return false;

    try {
      var style = window.getComputedStyle(el);
      var pos = style.position;
      if (pos === 'fixed' || pos === 'absolute') {
        var z = parseInt(style.zIndex, 10);
        if (!isNaN(z) && z > 1000) {
          var rect = el.getBoundingClientRect();
          var winW = window.innerWidth || document.documentElement.clientWidth;
          var winH = window.innerHeight || document.documentElement.clientHeight;
          if (rect.width >= winW * 0.7 && rect.height >= winH * 0.7) {
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (isOverlayAd(node)) {
      console.warn('[StreamShield] Removed overlay element:', node);
      node.remove();
      return;
    }
    var children = node.children;
    if (children) {
      for (var i = 0; i < children.length; i++) {
        if (isOverlayAd(children[i])) {
          console.warn('[StreamShield] Removed overlay child element:', children[i]);
          children[i].remove();
        }
      }
    }
  }

  var observer = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var mutation = mutations[m];
      if (mutation.type === 'childList') {
        for (var a = 0; a < mutation.addedNodes.length; a++) {
          scanNode(mutation.addedNodes[a]);
        }
      } else if (mutation.type === 'attributes') {
        scanNode(mutation.target);
      }
    }
  });

  function startObserver() {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
      var candidates = document.querySelectorAll('div, a, span, section');
      for (var c = 0; c < candidates.length; c++) {
        if (isOverlayAd(candidates[c])) {
          candidates[c].remove();
        }
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();`;
}

/**
 * HTMLRewriter handler to prepend <base> and the shield script into <head>
 */
class HeadHandler {
  constructor(htmlToPrepend) {
    this.injected = false;
    this.html = htmlToPrepend;
  }
  element(el) {
    if (!this.injected) {
      el.prepend(this.html, { html: true });
      this.injected = true;
    }
  }
}

/**
 * Fallback handler if page lacks a <head> tag
 */
class FallbackHeadHandler {
  constructor(headHandler) {
    this.headHandler = headHandler;
  }
  element(el) {
    if (!this.headHandler.injected) {
      el.prepend(this.headHandler.html, { html: true });
      this.headHandler.injected = true;
    }
  }
}

/**
 * HTMLRewriter handler to remove <script> tags whose src matches blocklist
 */
class ScriptBlocker {
  constructor(blocklist) {
    this.blocklist = blocklist.map(term => term.toLowerCase());
  }
  element(el) {
    const src = el.getAttribute('src');
    if (src) {
      const lower = src.toLowerCase();
      if (this.blocklist.some(term => lower.includes(term))) {
        el.remove();
      }
    }
  }
}

/**
 * HTMLRewriter handler to rewrite nested iframes through the worker proxy
 */
class IframeRewriter {
  constructor(workerOrigin, targetOrigin) {
    this.workerOrigin = workerOrigin;
    this.targetOrigin = targetOrigin;
  }
  element(el) {
    // Crucial: remove sandbox attribute (players detect and fail under sandbox)
    el.removeAttribute('sandbox');

    ['src', 'data-src'].forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && !val.startsWith('about:') && !val.startsWith('javascript:') && !val.startsWith('data:')) {
        try {
          const resolved = new URL(val, this.targetOrigin);
          if (resolved.origin !== this.workerOrigin) {
            const encodedOrigin = encodeURIComponent(resolved.origin);
            const proxiedSrc = `${PROXY_PREFIX}${encodedOrigin}${resolved.pathname}${resolved.search}`;
            el.setAttribute(attr, proxiedSrc);
          }
        } catch (e) {}
      }
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const url = new URL(request.url);
    const workerOrigin = url.origin;
    let upstreamUrl;
    let currentTargetOrigin = TARGET;

    // Check if request is for a proxied nested iframe: /__p/<encoded-origin>/<path>
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      const rest = url.pathname.slice(PROXY_PREFIX.length);
      const slashIdx = rest.indexOf('/');
      const encodedOrigin = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
      const subPath = slashIdx === -1 ? '/' : rest.slice(slashIdx);

      try {
        currentTargetOrigin = decodeURIComponent(encodedOrigin);
        upstreamUrl = new URL(subPath + url.search, currentTargetOrigin);
      } catch (e) {
        return new Response('Invalid proxy target origin', { status: 400 });
      }
    } else {
      upstreamUrl = new URL(url.pathname + url.search, TARGET);
    }

    // Build upstream request headers
    const newReqHeaders = new Headers(request.headers);
    newReqHeaders.set('host', upstreamUrl.host);
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      newReqHeaders.set('referer', currentTargetOrigin + '/');
    } else {
      newReqHeaders.set('referer', REFERER);
    }

    const userAgent = request.headers.get('user-agent');
    if (userAgent) {
      newReqHeaders.set('user-agent', userAgent);
    }

    // Forward request to upstream target
    let response = await fetch(upstreamUrl.toString(), {
      method: request.method,
      headers: newReqHeaders,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow'
    });

    // SPA fallback: If target returns 404 for route (e.g. /embed/:id or /watch), fallback to /
    if (response.status === 404 && request.method === 'GET' && !url.pathname.startsWith(PROXY_PREFIX) && !url.pathname.includes('.')) {
      const fallbackUrl = new URL('/' + url.search, TARGET);
      newReqHeaders.set('host', fallbackUrl.host);
      response = await fetch(fallbackUrl.toString(), {
        method: 'GET',
        headers: newReqHeaders,
        redirect: 'follow'
      });
    }

    const contentType = response.headers.get('content-type') || '';

    // Requirement 2: If response is NOT text/html, return untouched (video segments stream direct)
    if (!contentType.toLowerCase().includes('text/html')) {
      return response;
    }

    // Prepare modified headers for HTML response
    const newResHeaders = new Headers(response.headers);
    newResHeaders.delete('content-security-policy');
    newResHeaders.delete('content-security-policy-report-only');
    newResHeaders.delete('x-frame-options');
    newResHeaders.delete('content-length');
    newResHeaders.set('Access-Control-Allow-Origin', '*');
    newResHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    newResHeaders.set('Access-Control-Allow-Headers', '*');

    // Prepend <base> and inline shield script
    const prependHtml = `<base href="${currentTargetOrigin}/"><script>${buildShieldScript(currentTargetOrigin)}</script>`;
    const headHandler = new HeadHandler(prependHtml);

    // Stream transformation with HTMLRewriter (minimal CPU, streaming, no full-body buffering)
    const rewriter = new HTMLRewriter()
      .on('head', headHandler)
      .on('html', new FallbackHeadHandler(headHandler))
      .on('body', new FallbackHeadHandler(headHandler))
      .on('script', new ScriptBlocker(SCRIPT_BLOCKLIST))
      .on('iframe', new IframeRewriter(workerOrigin, currentTargetOrigin));

    return rewriter.transform(new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newResHeaders
    }));
  }
};
