// ==UserScript==
// @name         AI Studio 复制 LaTeX
// @namespace    aistudio-copy-latex
// @version      1.1.3
// @description  复制选中的 AI Studio 回复时，将公式还原为 LaTeX 纯文本。
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @noframes
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const formulaSelector = 'ms-katex, .katex-display, .katex';
  const annotationSelector = 'annotation[encoding="application/x-tex"]';
  const textElements = new Set([
    'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'code', 'dd',
    'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
  ]);

  function containingFormula(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const wrapper = element?.closest('ms-katex') ??
      element?.closest('.katex-display') ?? element?.closest('.katex');
    return readLatex(wrapper) ? wrapper : null;
  }

  function readLatex(formula) {
    return formula?.querySelector(annotationSelector)?.textContent.trim();
  }

  function appendTextStructure(source, destination) {
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        destination.append(child.data);
      } else if (child.nodeType === Node.ELEMENT_NODE &&
                 !child.matches('script, style, template, noscript, button, svg, [hidden]')) {
        const tag = child.localName;
        if (textElements.has(tag)) {
          const element = document.createElement(tag);
          appendTextStructure(child, element);
          destination.append(element);
        } else {
          appendTextStructure(child, destination);
        }
      }
    }
  }

  function renderedText(fragment) {
    // Let the browser handle spacing and block breaks using inert, text-only markup.
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.inert = true;
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0 auto auto 0',
      pointerEvents: 'none',
      opacity: '0'
    });
    const shadow = host.attachShadow({ mode: 'closed' });
    const content = document.createElement('div');
    content.style.whiteSpace = 'normal';
    appendTextStructure(fragment, content);
    shadow.append(content);
    document.body.append(host);
    try {
      return content.innerText;
    } finally {
      host.remove();
    }
  }

  function selectedLatex() {
    if (!document.body) return;
    const selection = document.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;

    const range = selection.getRangeAt(0).cloneRange();
    const start = range.startContainer;
    const end = range.endContainer;
    if (start.parentElement?.isContentEditable || end.parentElement?.isContentEditable) return;

    const firstFormula = containingFormula(range.startContainer);
    const lastFormula = containingFormula(range.endContainer);
    if (!firstFormula && !lastFormula &&
        !range.commonAncestorContainer.querySelector?.(annotationSelector)) {
      return;
    }

    if (firstFormula) range.setStartBefore(firstFormula);
    if (lastFormula) range.setEndAfter(lastFormula);

    const fragment = range.cloneContents();
    let converted = false;
    for (const formula of fragment.querySelectorAll(formulaSelector)) {
      // Once the outer wrapper is replaced, its nested KaTeX nodes are detached.
      if (!fragment.contains(formula)) continue;
      const latex = readLatex(formula);
      if (!latex) continue;

      if (formula.matches('ms-katex.display, .katex-display') ||
          formula.querySelector('.katex-display, math[display="block"]')) {
        const block = document.createElement('pre');
        block.textContent = latex;
        formula.replaceWith(block);
      } else {
        formula.replaceWith(document.createTextNode(latex));
      }
      converted = true;
    }

    if (converted) return renderedText(fragment);
  }

  window.addEventListener('copy', (event) => {
    if (!event.clipboardData || event.target?.closest?.('input, textarea')) return;
    const text = selectedLatex();
    if (!text) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  GM_registerMenuCommand('复制选区中的 LaTeX', () => {
    const text = selectedLatex();
    if (text) {
      GM_setClipboard(text, 'text');
    } else {
      window.alert('当前选区没有检测到包含 LaTeX 源码的公式。请先选中 AI Studio 回复里的公式。');
    }
  });
})();
