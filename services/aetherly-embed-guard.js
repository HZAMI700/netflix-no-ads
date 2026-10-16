(function (global) {
  'use strict';

  /**
   * AetherlyEmbedGuard - Advanced Multi-Layer Anti-Popup & Anti-Redirect Shield
   * Provides 4-layer protection around video player iframes on streamnaro.online:
   *  1. Click Shield Overlay (initial click passes through, auto-locks z-index: 10 1200ms after iframe blur)
   *  2. High-Speed Focus Guard (on window blur to iframe, blurs iframe and refocuses guard + window at 60ms)
   *  3. Redirect / Tab-Under Lock (beforeunload interceptor while pointer is inside guard wrapper)
   *  4. Safe Floating Controls (z-index: 20 Fullscreen and 3s Interact button)
   */
  const AetherlyEmbedGuard = {
    VERSION: '1.0.0',
    ALLOW_POLICY: "autoplay; fullscreen; encrypted-media; window-management 'none'",
    SHIELD_Z_INDEX: 10,
    CONTROLS_Z_INDEX: 20,
    SHIELD_AUTO_ACTIVATE_DELAY: 1200, // 1200ms after window blur to iframe
    FOCUS_SNAP_DELAY: 60, // 60ms refocus to kill multi-popup chains

    _active: false,
    _shieldActive: false,
    _firstClickDone: false,
    _pointerInside: false,
    _activateTimer: null,
    _unlockTimer: null,
    _countdownInterval: null,
    _container: null,

    getContainer() {
      if (this._container && document.body.contains(this._container)) {
        return this._container;
      }
      this._container = document.querySelector('.aetherly-embed-guard') ||
                        document.getElementById('aetherlyEmbedGuard') ||
                        document.getElementById('playerView');
      return this._container;
    },

    configureIframe(iframe) {
      if (!iframe) return;
      iframe.setAttribute('credentialless', '');
      try { iframe.credentialless = true; } catch {}
      iframe.removeAttribute('sandbox');
      iframe.setAttribute('allow', this.ALLOW_POLICY);
      iframe.setAttribute('referrerpolicy', 'origin');
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;z-index:1';
      return iframe;
    },

    arm() {
      this.clearTimers();
      this._firstClickDone = false;
      this._shieldActive = false;

      const shield = this.getShieldElement();
      if (shield) {
        shield.style.position = 'absolute';
        shield.style.inset = '0';
        shield.style.width = '100%';
        shield.style.height = '100%';
        shield.style.zIndex = String(this.SHIELD_Z_INDEX);
        shield.style.display = 'block';
        shield.style.pointerEvents = 'none'; // Initial click passes through to start playback
        shield.style.background = 'transparent';
        shield.style.cursor = 'pointer';
      }

      const controls = document.getElementById('pShieldControls');
      if (controls) {
        controls.style.display = 'flex';
        controls.style.zIndex = String(this.CONTROLS_Z_INDEX);
      }
      const label = document.getElementById('pUnlockShieldLabel');
      if (label) label.textContent = 'Interact (3s)';
    },

    activateShield() {
      const container = this.getContainer();
      if (!container || !container.classList.contains('show')) return;

      this._shieldActive = true;
      const shield = this.getShieldElement();
      if (shield) {
        shield.style.position = 'absolute';
        shield.style.inset = '0';
        shield.style.width = '100%';
        shield.style.height = '100%';
        shield.style.zIndex = String(this.SHIELD_Z_INDEX);
        shield.style.display = 'block';
        shield.style.pointerEvents = 'auto'; // Protect against click-hijacking and ad popups
        shield.style.background = 'transparent';
        shield.style.cursor = 'pointer';

        shield.onclick = (e) => {
          if (e) {
            try { e.preventDefault(); } catch {}
            try { e.stopPropagation(); } catch {}
          }
          if (typeof global.toast === 'function') {
            global.toast('Player protected against ads. Controls unlock automatically on hover.');
          }
        };
        shield.ontouchend = shield.onclick;
      }

      const controls = document.getElementById('pShieldControls');
      if (controls) {
        controls.style.display = 'flex';
        controls.style.zIndex = String(this.CONTROLS_Z_INDEX);
      }
      const label = document.getElementById('pUnlockShieldLabel');
      if (label) label.textContent = 'Interact (3s)';
    },

    disarmShield(seconds = 3) {
      this.clearTimers();
      this._shieldActive = false;

      const shield = this.getShieldElement();
      if (shield) {
        shield.style.display = 'none';
        shield.style.pointerEvents = 'none';
      }

      if (typeof seconds === 'number' && seconds > 0) {
        let remaining = seconds;
        const label = document.getElementById('pUnlockShieldLabel');
        if (label) label.textContent = `Interact (${remaining}s)`;
        if (typeof global.toast === 'function') {
          global.toast(`Controls unlocked for ${seconds}s`);
        }

        this._countdownInterval = setInterval(() => {
          remaining--;
          if (remaining > 0 && label) {
            label.textContent = `Interact (${remaining}s)`;
          } else {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
          }
        }, 1000);

        this._unlockTimer = setTimeout(() => {
          this.activateShield();
          if (typeof global.toast === 'function') {
            global.toast('Player protected against ads.');
          }
        }, seconds * 1000);
      } else {
        const label = document.getElementById('pUnlockShieldLabel');
        if (label) label.textContent = 'Interact (3s)';
      }
    },

    interact(seconds = 3) {
      this.disarmShield(seconds);
    },

    toggleFullscreen() {
      const container = this.getContainer();
      if (!container) return;

      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
      if (!isFull) {
        if (container.requestFullscreen) {
          container.requestFullscreen().catch(() => {});
        } else if (container.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (container.mozRequestFullScreen) {
          container.mozRequestFullScreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        }
      }
    },

    handleWindowBlur(iframe) {
      if (!iframe || document.activeElement !== iframe) return;

      // 1. Immediately trigger iframe.blur()
      try { iframe.blur(); } catch {}

      // 2. Refocus hidden guard button
      const guardBtn = this.getGuardButton();
      if (guardBtn) {
        try { guardBtn.focus(); } catch {}
      }

      // 3. Immediately focus window
      try { window.focus(); } catch {}
      try { window.top?.focus(); } catch {}
      try { self.focus(); } catch {}

      // 4. Refocus hidden guard button + window.focus() after 60ms to kill multi-popup chains
      setTimeout(() => {
        if (guardBtn) {
          try { guardBtn.focus(); } catch {}
        }
        try { window.focus(); } catch {}
        try { window.top?.focus(); } catch {}
        try { self.focus(); } catch {}
      }, this.FOCUS_SNAP_DELAY);

      // 5. Automatically activate transparent shield (z-index: 10) 1200ms after window blur
      if (!this._firstClickDone) {
        this._firstClickDone = true;
        clearTimeout(this._activateTimer);
        this._activateTimer = setTimeout(() => {
          this.activateShield();
        }, this.SHIELD_AUTO_ACTIVATE_DELAY);
      }
    },

    isPointerInside() {
      return this._pointerInside;
    },

    setPointerInside(val) {
      this._pointerInside = !!val;
    },

    getShieldElement() {
      let shield = document.getElementById('vidShield');
      if (!shield) {
        shield = document.createElement('div');
        shield.id = 'vidShield';
        shield.className = 'aetherly-shield-overlay';
        const container = this.getContainer();
        const pTop = document.getElementById('pTop');
        if (container) {
          container.insertBefore(shield, pTop || container.firstChild);
        }
      }
      return shield;
    },

    getGuardButton() {
      let btn = document.getElementById('pFocusTrap') || document.getElementById('aetherlyFocusGuard');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'pFocusTrap';
        btn.className = 'aetherly-focus-guard';
        btn.setAttribute('tabindex', '-1');
        btn.setAttribute('aria-hidden', 'true');
        btn.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0;overflow:hidden;outline:none;';
        const container = this.getContainer();
        if (container) container.appendChild(btn);
      }
      return btn;
    },

    clearTimers() {
      clearTimeout(this._activateTimer);
      clearTimeout(this._unlockTimer);
      if (this._countdownInterval) {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AetherlyEmbedGuard;
  }
  global.AetherlyEmbedGuard = AetherlyEmbedGuard;
})(typeof window !== 'undefined' ? window : global);
