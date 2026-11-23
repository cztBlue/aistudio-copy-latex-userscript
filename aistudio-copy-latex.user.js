// ==UserScript==
// @name         AI Studio 复制 LaTeX
// @namespace    aistudio-copy-latex
// @version      1.6.0
// @description  复制 LaTeX 公式，并修复 AI Studio 中部分多行公式的换行。
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @noframes
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.js#sha384-a1WQdjRj162i159OYq041X6I4K8NenkrI09LlPmiHg0YOb7CR+wJOraXwK9abpnE
// @resource     katexStyles https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css#sha384-WwGtaC6ywCHxA5cstpj/3+xIZvTez8dq2IcBQaXRkenHZ7FVVq1ZROtURwfbtTlG
// ==/UserScript==

(() => {
  'use strict';

  const formulaSelector = 'ms-katex, .katex-display, .katex';
  const annotationSelector = 'annotation[encoding="application/x-tex"]';
  const rowEnvironments = new Set(['aligned', 'alignedat', 'cases', 'dcases', 'rcases', 'drcases']);
  const rawMathBlock = /(?<!\\)\\begin\s*\{([a-z]+)\}[\s\S]*?\\end\s*\{\1\}/g;
  const formulaMarkers = new Map();
  const markersByFormula = new Map();
  const markerPrefix = 'AISTUDIOLATEX' + Math.random().toString(36).slice(2) + 'X';
  const markerPattern = new RegExp(markerPrefix + '\\d+Z', 'g');
  let markersReady = false;
  const layoutToken = /\\(begin|end)\s*\{([a-z]+)\}|\\\\|\\(?=[ \t]*(?:\r?\n|[ \t]&))|\\\[[ \t]*[+-]?[ \t]*(?:\d+(?:\.\d*)?|\.\d+)[ \t]*(?:pt|mm|cm|in|bp|pc|dd|cc|nd|nc|sp|px|em|ex|mu)[ \t]*\]|\\[^\r\n]|%[^\r\n]*|[{}]/g;
  const textElements = new Set([
    'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'code', 'dd',
    'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4',
    'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
  ]);

  function repairRowBreaks(latex) {
    if (!latex.includes('\\begin')) return latex;
    const environments = [];
    let braceDepth = 0;
    return latex.replace(layoutToken, (token, command, name) => {
      if (command === 'begin') {
        environments.push({ name, braceDepth });
      } else if (command === 'end' && environments.at(-1)?.name === name) {
        environments.pop();
      } else if (token === '{') {
        braceDepth++;
      } else if (token === '}') {
        braceDepth--;
      } else if (token === '\\' || (token.length > 2 && token.startsWith('\\['))) {
        const environment = environments.at(-1);
        if (environment?.braceDepth === braceDepth && rowEnvironments.has(environment.name)) {
          return '\\' + token;
        }
      }
      return token;
    });
  }

  function repairReplyMarkdown(markdown, renderLocally = false, decision) {
    if (!markdown.includes('\\begin')) return markdown;
    // Protect code, but allow formulas next to prose and inside existing math delimiters.
    const chunks = /^ {0,3}(\x60{3,}|~{3,})[^\r\n]*(?:\r?\n|$)[\s\S]*?(?:^ {0,3}\1[^\S\r\n]*(?=\r?$)|(?![\s\S]))|(\x60+)[^\r\n]*?\2|(\$\$[\s\S]*?\$\$|\\\[(?![ \t]*[+-]?[ \t]*[\d.])[^\S\r\n]*[\s\S]*?\\\]|(?<!\$)\$(?!\$)[^\r\n$]+\$)|(?<!\\)\\begin\s*\{([a-z]+)\}[\s\S]*?\\end\s*\{\4\}/gm;
    return markdown.replace(chunks, (chunk, fence, inlineCode, delimitedMath, environment, offset) => {
      const report = (route) => decision?.(offset, chunk.length, route);
      if (fence || inlineCode) {
        if (chunk.includes('\\begin')) report('code');
        return chunk;
      }
      if (!delimitedMath && !rowEnvironments.has(environment)) {
        report('unsupported-environment');
        return chunk;
      }
      const repaired = repairRowBreaks(chunk);
      if (!renderLocally) return repaired;
      if (!markersReady) {
        report('observer-not-ready');
        return repaired;
      }
      if (!delimitedMath) {
        const marker = markFormula(repaired);
        report(marker ? 'marked' : 'marker-limit');
        return marker ?? repaired;
      }

      const delimiterWidth = repaired.startsWith('$$') || repaired.startsWith('\\[') ? 2 : 1;
      const body = repaired.slice(delimiterWidth, -delimiterWidth);
      const formulas = Array.from(body.matchAll(rawMathBlock)).filter(match => rowEnvironments.has(match[1]));
      if (!formulas.length || /^ {0,3}(?:\x60{3,}|~{3,})/m.test(body)) return repaired;
      const [first] = formulas;
      const before = body.slice(0, first.index).trim();
      const after = body.slice(first.index + first[0].length).trim();
      if (formulas.length === 1 && !/\r?\n/.test(before + after)) {
        const marker = markFormula(body.trim(), delimiterWidth === 2);
        report(marker ? 'marked-delimited' : 'marker-limit');
        return marker ?? repaired;
      }

      let end = 0;
      let output = '';
      for (const match of formulas) {
        const marker = markFormula(match[0]);
        if (!marker) {
          report('marker-limit');
          return repaired;
        }
        output += body.slice(end, match.index) + marker;
        end = match.index + match[0].length;
      }
      report('marked-delimited-group');
      return output + body.slice(end);
    });
  }

  function markFormula(latex, displayMode = true) {
    const key = (displayMode ? 'D' : 'I') + latex;
    const previous = markersByFormula.get(key);
    if (previous) return previous;
    if (formulaMarkers.size >= 1024) return;
    const marker = markerPrefix + formulaMarkers.size + 'Z';
    formulaMarkers.set(marker, { latex, displayMode });
    markersByFormula.set(key, marker);
    return marker;
  }

  const patchedRenderers = new WeakSet();
  let markdownParserPatched = false;

  function patchMarkdownParser() {
    const makerSuite = unsafeWindow.default_MakerSuite;
    if (!makerSuite || markdownParserPatched) return;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(makerSuite))) {
      const service = descriptor.value;
      if (typeof service !== 'function' || service.ta?.token !== service) continue;
      const parser = service.prototype;
      if (typeof parser?.A !== 'function' || typeof parser.H !== 'function') continue;
      const original = parser.A;
      const parse = Function.prototype.toString.call(original);
      const inspect = Function.prototype.toString.call(parser.H);
      if (!parse.includes('.parse(') || !inspect.includes('.parse(') || !inspect.includes('.getType()===5')) continue;

      parser.A = function (markdown, ...args) {
        const repaired = typeof markdown === 'string' ? repairReplyMarkdown(markdown, true) : markdown;
        return Reflect.apply(original, this, [repaired, ...args]);
      };
      markdownParserPatched = true;
      return;
    }
  }

  function patchKatex() {
    const katex = unsafeWindow.katex;
    if (typeof katex?.render !== 'function' || patchedRenderers.has(katex)) return;
    const originalRender = katex.render;
    katex.render = function (latex, target, ...options) {
      if (typeof latex === 'string' && target?.closest?.('ms-katex')) {
        const repaired = repairRowBreaks(latex);
        if (repaired !== latex) {
          try {
            return Reflect.apply(originalRender, this, [repaired, target, ...options]);
          } catch {
            // Let AI Studio handle unsupported expressions as it normally does.
          }
        }
      }
      return Reflect.apply(originalRender, this, [latex, target, ...options]);
    };
    patchedRenderers.add(katex);
  }

  // The recorded AI Studio bundle reads window.katex in the script's load callback.
  // Capture the resource event before that callback schedules the first render.
  function patchPageRenderers() {
    patchMarkdownParser();
    patchKatex();
  }

  document.addEventListener('load', (event) => {
    if (event.target?.localName === 'script') patchPageRenderers();
  }, true);
  patchPageRenderers();

  function standaloneFormula(text) {
    const trimmed = text.trim();
    const unwrapped = trimmed.replace(/^\$\$([\s\S]*?)\$\$$|^\\\[([\s\S]*?)\\\]$/, '$1$2').trim();
    const start = unwrapped.match(/^\\begin\s*\{([a-z]+)\}/);
    if (!start || !rowEnvironments.has(start[1])) return;
    const end = '\\end{' + start[1] + '}';
    if (unwrapped.endsWith(end)) return unwrapped;
  }

  let katexStyleReady;

  function loadKatexStyle() {
    if (katexStyleReady !== undefined) return katexStyleReady;
    katexStyleReady = false;
    try {
      const css = GM_getResourceText('katexStyles');
      if (!css?.includes('.katex-html')) return false;
      const fontBase = 'https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/';
      const googleFontBase = 'https://www.gstatic.com/external_hosted/katex/dist/';
      const fontRules = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
      const fonts = fontRules.join('\n')
        .replace(/url\(["']?(fonts\/[^)"']+)["']?\)\s*(format\([^)]+\))/g,
          (_, path, format) => 'url("' + googleFontBase + path + '") ' + format +
            ',url("' + fontBase + path + '") ' + format)
        .replace(/font-display\s*:\s*block/g, 'font-display:swap');
      const rules = css.replace(/@font-face\s*\{[^}]*\}/g, '').replace(/\/\*# sourceMappingURL=[^*]*\*\//g, '');
      const scoped = typeof CSSScopeRule === 'undefined' ? rules : '@scope ([data-aistudio-katex]) {\n' + rules + '\n}';
      GM_addStyle(fonts + '\n' + scoped + '\n' + [
        '[data-aistudio-katex] .katex { font-size: 1.1em; }',
        '[data-aistudio-display-math] { display: block; max-width: 100%; overflow-x: auto; }',
        '[data-aistudio-display-math] > .katex-display { width: max-content; min-width: 100%; margin: .45em 0; }'
      ].join('\n'));
      katexStyleReady = true;
    } catch {
      // Keep formulas readable with native MathML if the stylesheet is unavailable.
    }
    return katexStyleReady;
  }

  function renderFormula(latex, target, displayMode = true) {
    const renderer = typeof katex === 'undefined' ? unsafeWindow.katex : katex;
    if (typeof renderer?.render !== 'function') return false;
    const styled = loadKatexStyle();
    if (styled) {
      target.setAttribute('data-aistudio-katex', '');
      if (displayMode) target.setAttribute('data-aistudio-display-math', '');
    }
    try {
      renderer.render(repairRowBreaks(latex), target, {
        displayMode, output: styled ? 'htmlAndMathml' : 'mathml', trust: false
      });
      return true;
    } catch {
      return false;
    }
  }

  function startRawFormulaRendering() {
    const reply = 'ms-chat-turn, ms-text-chunk, ms-conversation-markdown, .chat-session-content';
    const prose = 'p, .fallback-text, .very-large-text-container';
    const block = prose + ', ms-cmark-node';
    const excluded = 'ms-katex, .katex, pre, code, [contenteditable="true"], [data-aistudio-latex-preview]';
    const sourceAttribute = 'data-aistudio-latex-source';
    const pending = new Set();
    const displayed = new Map();
    const markerNodes = new Set();
    const inserted = new Map();
    let frame;

    GM_addStyle('[' + sourceAttribute + '] { display: none !important; }');

    function sourceText(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.data;
      if (node.nodeName === 'BR') return '\n';
      return Array.from(node.childNodes, sourceText).join('');
    }

    function queueMarkers(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.data.includes(markerPrefix)) markerNodes.add(node);
        return;
      }
      if (!node.textContent?.includes(markerPrefix)) return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (text.data.includes(markerPrefix)) markerNodes.add(text);
      }
    }

    function renderMarkers(node) {
      if (!node.isConnected) return;
      const raw = node.data;
      if (node.parentElement?.closest('pre, code, [contenteditable="true"]')) {
        node.data = raw.replace(markerPattern, marker => formulaMarkers.get(marker)?.latex ?? marker);
        return;
      }
      const replacement = document.createElement('span');
      replacement.setAttribute('data-aistudio-latex-preview', '');
      let end = 0;
      for (const match of raw.matchAll(markerPattern)) {
        const formula = formulaMarkers.get(match[0]);
        if (!formula) continue;
        const { latex, displayMode } = formula;
        const rendered = document.createElement('span');
        if (displayMode) {
          rendered.style.display = 'block';
          rendered.style.overflowX = 'auto';
        }
        replacement.append(raw.slice(end, match.index), renderFormula(latex, rendered, displayMode) ? rendered : latex);
        end = match.index + match[0].length;
      }
      if (!end) return;
      replacement.append(raw.slice(end));
      inserted.get(node)?.remove();
      node.after(replacement);
      // Keep the Text node Angular owns so streamed updates can still reach it.
      node.data = '';
      inserted.set(node, replacement);
    }

    function reconcile(source) {
      const previous = displayed.get(source);
      const eligible = source.isConnected && source.textContent.includes('\\begin') &&
        source.closest(reply) && !source.closest(excluded) &&
        !source.parentElement?.closest(prose) &&
        !source.parentElement?.closest('[' + sourceAttribute + ']') &&
        !source.querySelector('[' + sourceAttribute + '], ' + excluded);
      const raw = eligible ? sourceText(source) : undefined;
      if (previous?.raw === raw && previous?.preview.previousElementSibling === source) return;
      if (previous) {
        previous.preview.remove();
        source.removeAttribute(sourceAttribute);
        displayed.delete(source);
      }
      if (!raw) return;
      const preview = document.createElement('div');
      preview.setAttribute('data-aistudio-latex-preview', '');
      preview.style.overflowX = 'auto';
      const formula = standaloneFormula(raw);
      if (formula ? !renderFormula(formula, preview) : !renderMixedText(raw, source, preview)) return;
      source.after(preview);
      source.setAttribute(sourceAttribute, '');
      displayed.set(source, { raw, preview });
    }

    function renderMixedText(raw, source, preview) {
      // Keep rich Markdown such as links and images in its original DOM.
      if (/^ {0,3}(?:\x60{3,}|~{3,})/m.test(raw) ||
          source.querySelector('a, img, button, em, strong, table, ul, ol, blockquote')) return false;
      let end = 0;
      for (const match of raw.matchAll(rawMathBlock)) {
        if (!rowEnvironments.has(match[1])) continue;
        const rendered = document.createElement('div');
        if (!renderFormula(match[0], rendered)) continue;
        let before = raw.slice(end, match.index);
        const after = match.index + match[0].length;
        const opening = before.match(/(\$\$|\\\[)\s*$/);
        const closing = opening && raw.slice(after).match(
          opening[1] === '$$' ? /^\s*\$\$/ : /^\s*\\\]/);
        if (closing) before = before.slice(0, opening.index);
        preview.append(before, rendered);
        end = after + (closing?.[0].length ?? 0);
      }
      if (!end) return false;
      preview.append(raw.slice(end));
      preview.style.whiteSpace = 'pre-wrap';
      return true;
    }

    function queueAncestors(node) {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (!element?.closest(reply) || element.closest(excluded)) return;
      for (let candidate = element.closest(block); candidate; candidate = candidate.parentElement?.closest(block)) {
        pending.add(candidate);
      }
    }

    function queueDescendants(node) {
      if (!node.querySelectorAll || node.closest?.(excluded)) return;
      for (const candidate of node.querySelectorAll(block)) {
        if (candidate.closest(reply)) pending.add(candidate);
      }
    }

    function schedule() {
      if ((!pending.size && !markerNodes.size) || frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        for (const node of markerNodes) renderMarkers(node);
        markerNodes.clear();
        for (const source of pending) reconcile(source);
        pending.clear();
      });
    }

    new MutationObserver((records) => {
      let removedNodes = false;
      for (const record of records) {
        queueAncestors(record.target);
        if (record.type === 'characterData') {
          const node = record.target;
          if (inserted.has(node) && node.data) {
            inserted.get(node).remove();
            inserted.delete(node);
          }
          queueMarkers(node);
        }
        for (const node of record.addedNodes) {
          queueAncestors(node);
          queueDescendants(node);
          queueMarkers(node);
        }
        if (record.removedNodes.length) removedNodes = true;
      }
      if (removedNodes) {
        for (const [node, preview] of inserted) {
          if (!node.isConnected || preview.parentNode !== node.parentNode) {
            preview.remove();
            inserted.delete(node);
          }
        }
        for (const [source, { preview }] of displayed) {
          if (!source.isConnected || preview.previousElementSibling !== source) pending.add(source);
        }
      }
      schedule();
    }).observe(document.body, { subtree: true, childList: true, characterData: true });

    markersReady = true;
    for (const section of document.querySelectorAll(reply)) queueDescendants(section);
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRawFormulaRendering, { once: true });
  } else {
    startRawFormulaRendering();
  }

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

  GM_registerMenuCommand('预览修复后的多行 LaTeX', () => {
    const latex = standaloneFormula(document.getSelection()?.toString() ?? '');
    if (!latex) {
      window.alert('请完整选中包含 \\begin 和 \\end 的多行公式，且只选公式源码。');
      return;
    }
    const repaired = repairRowBreaks(latex);

    const dialog = document.createElement('dialog');
    const preview = document.createElement('div');
    const close = document.createElement('button');
    const copy = document.createElement('button');
    close.textContent = '关闭';
    copy.textContent = '复制修正后的 LaTeX';
    close.addEventListener('click', () => dialog.close());
    copy.addEventListener('click', () => GM_setClipboard(repaired, 'text', () => {
      copy.textContent = '已复制';
    }));
    dialog.addEventListener('close', () => dialog.remove());
    dialog.style.maxWidth = '90vw';
    preview.style.overflowX = 'auto';
    if (!renderFormula(repaired, preview)) {
      GM_setClipboard(repaired, 'text');
      window.alert('公式仍有渲染错误，已复制修正后的 LaTeX 供检查。');
      return;
    }
    dialog.append(preview, copy, close);
    document.body.append(dialog);
    dialog.showModal();
  });
})();
