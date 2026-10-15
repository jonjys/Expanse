/* Small dependency-free helpers shared by the browser and Node regression tests. */
(function (root) {
  'use strict';
  function storage(getStorage) {
    return {
      get(key) { try { return JSON.parse(getStorage().getItem(key)); } catch { return null; } },
      set(key, value) {
        try {
          const raw = JSON.stringify(value), target = getStorage();
          target.setItem(key, raw);
          return target.getItem(key) === raw;
        } catch { return false; }
      },
      del(key) { try { getStorage().removeItem(key); return true; } catch { return false; } }
    };
  }
  function dialogs(doc) {
    const stack = [];
    const tabbable = node => Array.from(node.querySelectorAll('a[href],button,input,textarea,select,[tabindex]'))
      .filter(e => !e.disabled && e.tabIndex >= 0 && !e.closest('[hidden],[inert]') && e.getClientRects().length);
    const focus = entry => {
      const target = tabbable(entry.node)[0] || entry.node.querySelector('[tabindex="-1"]') || entry.node;
      target.focus({ preventScroll: true });
    };
    doc.addEventListener('keydown', e => {
      if (e.key !== 'Tab' || !stack.length) return;
      const entry = stack[stack.length - 1], items = tabbable(entry.node);
      const index = items.indexOf(doc.activeElement);
      if (!items.length) { e.preventDefault(); focus(entry); return; }
      if (index < 0 || (!e.shiftKey && index === items.length - 1) || (e.shiftKey && index === 0)) {
        e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus({ preventScroll: true });
      }
    });
    doc.addEventListener('focusin', () => {
      const entry = stack[stack.length - 1];
      if (entry && !entry.node.contains(doc.activeElement)) focus(entry);
    });
    return {
      open(node, preferred) {
        if (!stack.some(e => e.node === node)) stack.push({ node, opener: doc.activeElement });
        node.classList.add('open');
        if (preferred) preferred.focus({ preventScroll: true }); else focus(stack[stack.length - 1]);
      },
      close(node) {
        const index = stack.findIndex(e => e.node === node);
        if (index < 0) { node.classList.remove('open'); return; }
        const wasTop = index === stack.length - 1, entry = stack.splice(index, 1)[0];
        node.classList.remove('open');
        if (!wasTop) return;
        if (entry.opener && entry.opener.isConnected && (!stack.length || stack[stack.length - 1].node.contains(entry.opener))) entry.opener.focus({ preventScroll: true });
        else if (stack.length) focus(stack[stack.length - 1]);
      }
    };
  }
  const api = { storage, dialogs };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExpanseUI = api;
})(typeof globalThis === 'object' ? globalThis : this);
