/* @ds-bundle: {"format":4,"namespace":"CyAc","components":[{"name":"Button"},{"name":"Field"},{"name":"Tabs"},{"name":"Panel"},{"name":"Badge"},{"name":"Readout"},{"name":"Loader"},{"name":"Message"},{"name":"Thinking"},{"name":"ToolCall"},{"name":"CodeBlock"},{"name":"Composer"},{"name":"StatusBar"},{"name":"Menu"},{"name":"InputGroup"},{"name":"AcidGround"},{"name":"RuleStack"},{"name":"Registration"},{"name":"TickStrip"},{"name":"SequenceLog"},{"name":"Slug"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function pick(props, omit) { var o = {}; for (var k in props) if (omit.indexOf(k) < 0) o[k] = props[k]; return o; }

  function Button(props) {
    var variant = props.variant || 'secondary';
    var rest = pick(props, ['variant', 'size', 'code', 'children', 'className', 'type']);
    return h('button', Object.assign({
      type: props.type || 'button',
      className: cx('cy-btn', variant !== 'secondary' && 'cy-btn--' + variant, props.size && props.size !== 'm' && 'cy-btn--' + props.size, props.className)
    }, rest),
      props.code ? h('span', { className: 'cy-btn__code' }, props.code) : null,
      h('span', null, props.children));
  }

  var fieldSeq = 0;
  function Field(props) {
    var idRef = React.useRef(null);
    if (!idRef.current) idRef.current = props.id || 'cy-field-' + (++fieldSeq);
    var id = idRef.current;
    var hintId = id + '-hint';
    var hasHint = props.error || props.hint;
    var rest = pick(props, ['label', 'code', 'hint', 'error', 'id', 'className', 'multiline']);
    return h('div', { className: cx('cy-field', props.error && 'cy-field--error', props.className) },
      h('label', { className: 'cy-field__label', htmlFor: id },
        h('span', null, props.label),
        props.code ? h('span', null, props.code) : null),
      h(props.multiline ? 'textarea' : 'input', Object.assign({
        id: id, className: 'cy-field__input', rows: props.multiline ? (props.rows || 4) : undefined,
        'aria-invalid': props.error ? 'true' : undefined,
        'aria-describedby': hasHint ? hintId : undefined
      }, rest)),
      hasHint ? h('div', { id: hintId, className: 'cy-field__hint' },
        props.error ? h('span', { className: 'cy-field__flag' }, 'ALERT /') : null,
        props.error || props.hint) : null);
  }

  function Tabs(props) {
    var items = props.items || [];
    var controlled = props.value !== undefined;
    var st = React.useState(props.defaultValue !== undefined ? props.defaultValue : (items[0] && items[0].value));
    var value = controlled ? props.value : st[0];
    var refs = React.useRef([]);
    function select(v, i) {
      if (!controlled) st[1](v);
      if (props.onChange) props.onChange(v);
      if (i !== undefined && refs.current[i]) refs.current[i].focus();
    }
    function onKey(e, i) {
      var n = items.length, j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % n;
      if (e.key === 'ArrowLeft') j = (i - 1 + n) % n;
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = n - 1;
      if (j !== null) { e.preventDefault(); select(items[j].value, j); }
    }
    return h('div', { className: cx('cy-tabs', props.className), role: 'tablist', 'aria-label': props.label },
      items.map(function (it, i) {
        var on = it.value === value;
        return h('button', {
          key: it.value, type: 'button', role: 'tab', className: 'cy-tab',
          'aria-selected': on ? 'true' : 'false', tabIndex: on ? 0 : -1,
          ref: function (el) { refs.current[i] = el; },
          onClick: function () { select(it.value); },
          onKeyDown: function (e) { onKey(e, i); }
        },
          props.indexed === false ? null : h('span', { className: 'cy-tab__index' }, String(i + 1).padStart(2, '0')),
          h('span', null, it.label));
      }));
  }

  function Panel(props) {
    return h('section', { className: cx('cy-panel', props.bracketed && 'cy-panel--bracketed', props.active && 'cy-panel--active', props.className) },
      (props.title || props.code) ? h('header', { className: 'cy-panel__head' },
        props.title ? h('h3', { className: 'cy-panel__title' }, props.title) : h('span'),
        props.code ? h('span', { className: 'cy-panel__code' }, props.code) : null) : null,
      h('div', { className: 'cy-panel__body' }, props.children));
  }

  var BADGE_WORD = { accent: null, alert: 'ALERT', caution: 'CAUTION', info: 'INFO', neutral: null };
  function Badge(props) {
    var tone = props.tone || 'neutral';
    return h('span', { className: cx('cy-badge', tone !== 'neutral' && 'cy-badge--' + tone, props.className) },
      props.dot ? h('span', { className: 'cy-badge__dot', 'aria-hidden': 'true' }) : null,
      props.children || BADGE_WORD[tone]);
  }

  function Readout(props) {
    var d = props.delta;
    var dir = d && (String(d).charAt(0) === '-' ? 'down' : 'up');
    return h('div', { className: cx('cy-readout', props.className) },
      h('span', { className: 'cy-readout__label' }, props.label),
      h('span', { className: 'cy-readout__value' }, props.value,
        props.unit ? h('span', { className: 'cy-readout__unit' }, props.unit) : null),
      d ? h('span', { className: 'cy-readout__delta cy-readout__delta--' + dir }, (dir === 'up' ? '▲ ' : '▼ ') + String(d).replace(/^[-+]/, '')) : null);
  }

  function Loader(props) {
    var label = props.label === undefined ? 'Syncing' : props.label;
    return h('div', { className: cx('cy-loader', props.className), role: 'status', 'aria-live': 'polite' },
      h('span', { className: 'cy-loader__pills', 'aria-hidden': 'true' },
        h('span', { className: 'cy-loader__pill' }), h('span', { className: 'cy-loader__pill' }), h('span', { className: 'cy-loader__pill' })),
      label ? h('span', { className: 'cy-loader__label' }, label) : null);
  }


  /* ---------- Conversation ---------- */
  function Message(props) {
    var role = props.role || 'assistant';
    var name = props.name || (role === 'user' ? 'You' : 'CyAc');
    return h('article', { className: cx('cy-msg', 'cy-msg--' + role, props.className), 'aria-label': name + ' message' },
      h('header', { className: 'cy-msg__head' },
        h('span', { className: 'cy-msg__role' }, name),
        props.time ? h('time', null, props.time) : null,
        props.meta ? h('span', null, props.meta) : null),
      h('div', { className: 'cy-msg__body' }, props.children));
  }

  function Disclosure(cls, open, summary, body) {
    return h('details', { className: cx('cy-disc', cls), open: open || undefined },
      h('summary', null, h('span', { className: 'cy-disc__chev', 'aria-hidden': 'true' }), summary),
      body ? h('div', { className: 'cy-disc__body' }, body) : null);
  }
  function MiniPills() { return h('span', { className: 'cy-mini-pills', 'aria-hidden': 'true' }, h('span'), h('span'), h('span')); }

  function Thinking(props) {
    var live = !!props.streaming;
    return Disclosure(cx('cy-think', props.className), props.defaultOpen,
      [h('span', { key: 'l' }, live ? 'Thinking' : 'Thought'),
       live ? h(MiniPills, { key: 'p' }) : null,
       h('span', { key: 's', className: 'cy-disc__spacer' }),
       props.duration ? h('span', { key: 'd', className: 'cy-disc__meta' }, props.duration) : null],
      props.children);
  }

  var TOOL_WORD = { running: 'Running', ok: 'Done', error: 'Failed' };
  function ToolCall(props) {
    var status = props.status || 'ok';
    var fmt = function (v) { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); };
    var body = (props.input !== undefined || props.output !== undefined) ? [
      props.input !== undefined ? h('div', { key: 'i' }, h('div', { className: 'cy-tool__section-label' }, 'Input'), h('pre', { className: 'cy-tool__pre' }, fmt(props.input))) : null,
      props.output !== undefined ? h('div', { key: 'o' }, h('div', { className: 'cy-tool__section-label' }, status === 'error' ? 'Error' : 'Output'), h('pre', { className: 'cy-tool__pre' }, fmt(props.output))) : null
    ] : null;
    return Disclosure(cx('cy-tool', status === 'error' && 'cy-tool--error', props.className), props.defaultOpen,
      [h('span', { key: 'n', className: 'cy-tool__name' }, props.name),
       props.summary ? h('span', { key: 's', className: 'cy-tool__summary' }, props.summary) : null,
       h('span', { key: 'sp', className: 'cy-disc__spacer' }),
       props.duration && status !== 'running' ? h('span', { key: 'd', className: 'cy-disc__meta' }, props.duration) : null,
       h('span', { key: 'st', className: 'cy-tool__status cy-tool__status--' + status },
         status === 'running' ? h(MiniPills) : null, TOOL_WORD[status])],
      body);
  }

  var KW = 'const|let|var|function|return|if|else|for|while|import|from|export|default|class|new|await|async|try|catch|throw|def|in|not|and|or|None|True|False|null|true|false|undefined|self|with|as|pass|lambda|yield|type|interface|fn|pub|use|mut|impl|struct|enum|match|func|package';
  var TOKEN_RE = new RegExp('(\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`)|\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b|\\b(' + KW + ')\\b', 'g');
  function highlight(line, lang) {
    if (lang === 'text' || lang === 'plain') return line;
    var out = [], last = 0, m, i = 0;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(line))) {
      if (m[1] && m[1].charAt(0) === '#' && !/^(py|python|sh|bash|shell|yaml|yml|toml|rb|ruby)$/.test(lang || '')) { continue; }
      if (m.index > last) out.push(line.slice(last, m.index));
      var cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : 'k';
      out.push(h('span', { key: i++, className: 'cy-tok-' + cls }, m[0]));
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  }
  function CodeBlock(props) {
    var code = String(props.code || '').replace(/\n$/, '');
    var lines = code.split('\n');
    var hl = props.highlightLines || [];
    var st = React.useState(false), copied = st[0], setCopied = st[1];
    function copy() {
      var done = function () { setCopied(true); setTimeout(function () { setCopied(false); }, 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () {});
    }
    var numbered = props.lineNumbers === undefined ? lines.length > 3 : props.lineNumbers;
    return h('figure', { className: cx('cy-codeblock', numbered && 'cy-codeblock--numbered', props.className), style: { margin: 0 } },
      h('figcaption', { className: 'cy-codeblock__head' },
        h('span', { className: 'cy-codeblock__lang' }, props.language || 'text'),
        props.filename ? h('span', { className: 'cy-codeblock__file' }, props.filename) : null,
        props.copyable === false ? null : h('button', { type: 'button', className: 'cy-codeblock__copy', onClick: copy, 'data-copied': copied ? 'true' : 'false', 'aria-live': 'polite' }, copied ? 'Copied' : 'Copy')),
      h('pre', { className: 'cy-codeblock__pre' },
        h('code', null, lines.map(function (ln, i) {
          return h('span', { key: i, className: cx('cy-codeblock__line', hl.indexOf(i + 1) >= 0 && 'cy-codeblock__line--hl') }, highlight(ln, props.language));
        }))));
  }

  /* ---------- Inputs: Input, Addon, InputGroup ---------- */
  function Input(props) {
    return h('input', Object.assign({}, pick(props, ['className']), { className: cx('cy-input', props.className) }));
  }
  function Addon(props) { return h('span', { className: cx('cy-addon', props.className) }, props.children); }
  function InputGroup(props) {
    return h('div', { className: cx('cy-group', props.className), role: 'group', 'aria-label': props.label }, props.children);
  }

  /* ---------- Menu ---------- */
  function Menu(props) {
    var items = props.items || [];
    var st = React.useState(!!props.defaultOpen), open = st[0], setOpen = st[1];
    var root = React.useRef(null), itemRefs = React.useRef([]);
    var focusables = function () { return items.map(function (it, i) { return it.divider || it.disabled ? -1 : i; }).filter(function (i) { return i >= 0; }); };
    React.useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (root.current && !root.current.contains(e.target)) setOpen(false); }
      document.addEventListener('mousedown', onDoc);
      return function () { document.removeEventListener('mousedown', onDoc); };
    }, [open]);
    function focusAt(i) { var el = itemRefs.current[i]; if (el) el.focus(); }
    function choose(it) {
      if (it.disabled) return;
      if (props.onSelect) props.onSelect(it.value);
      setOpen(false);
      var t = root.current && root.current.querySelector('button'); if (t) t.focus();
    }
    function onTriggerKey(e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); var f = focusables(); setTimeout(function () { focusAt(e.key === 'ArrowDown' ? f[0] : f[f.length - 1]); }, 0); }
    }
    function onListKey(e) {
      var f = focusables(), cur = itemRefs.current.indexOf(document.activeElement), pos = f.indexOf(cur);
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(f[(pos + 1) % f.length]); }
      if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(f[(pos - 1 + f.length) % f.length]); }
      if (e.key === 'Home') { e.preventDefault(); focusAt(f[0]); }
      if (e.key === 'End') { e.preventDefault(); focusAt(f[f.length - 1]); }
      if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); if (e.key === 'Escape') { var t = root.current.querySelector('button'); if (t) t.focus(); } }
    }
    var selected = items.filter(function (it) { return it.value === props.value; })[0];
    var label = props.label !== undefined ? props.label : (selected ? selected.label : '');
    return h('div', { ref: root, className: cx('cy-menu', props.placement === 'top' && 'cy-menu--up', props.align === 'right' && 'cy-menu--right', props.className) },
      h(Button, { variant: props.variant || 'secondary', size: props.size, code: props.code, 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false',
        onClick: function () { setOpen(!open); }, onKeyDown: onTriggerKey },
        h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, label, h('span', { className: 'cy-menu__chev', 'aria-hidden': 'true' }))),
      open ? h('ul', { className: 'cy-menu__list', role: 'menu', onKeyDown: onListKey },
        items.map(function (it, i) {
          if (it.divider) return h('li', { key: 'd' + i, role: 'separator', className: 'cy-menu__sep' });
          var checkable = props.value !== undefined;
          return h('li', { key: it.value, role: checkable ? 'menuitemradio' : 'menuitem', tabIndex: -1,
            'aria-checked': checkable ? (it.value === props.value ? 'true' : 'false') : undefined,
            'aria-disabled': it.disabled ? 'true' : undefined,
            ref: function (el) { itemRefs.current[i] = el; },
            className: cx('cy-menu__item', it.danger && 'cy-menu__item--danger'),
            onClick: function () { choose(it); },
            onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(it); } } },
            checkable ? h('span', { className: 'cy-menu__check', 'aria-hidden': 'true' }, it.value === props.value ? '■' : '') : null,
            h('span', { className: 'cy-menu__label' }, it.label),
            it.code ? h('span', { className: 'cy-menu__code' }, it.code) : null);
        })) : null);
  }

  /* ---------- StatusBar + Metric ---------- */
  function Metric(props) {
    var pct = props.percent;
    return h('span', { className: cx('cy-metric', props.tone && 'cy-metric--' + props.tone, props.className) },
      h('span', null, props.label),
      pct !== undefined ? h('span', { className: 'cy-metric__bar', role: 'meter', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': props.label },
        h('span', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } })) : null,
      h('span', { className: 'cy-metric__value' }, props.value));
  }
  function StatusBar(props) {
    var left = props.left || [], right = props.right || [];
    var bar = React.useRef(null), rightRef = React.useRef(null), moreRef = React.useRef(null);
    var segRefs = React.useRef([]), widths = React.useRef([]);
    var vs = React.useState(left.length), visible = vs[0], setVisible = vs[1];
    var os = React.useState(false), open = os[0], setOpen = os[1];
    var MORE_W = 56;
    var fit = React.useCallback(function () {
      var el = bar.current; if (!el) return;
      for (var i = 0; i < left.length; i++) { var sEl = segRefs.current[i]; if (sEl && sEl.offsetParent !== null) widths.current[i] = sEl.offsetWidth; }
      var avail = el.clientWidth - (rightRef.current ? rightRef.current.offsetWidth : 0);
      var total = 0, n = 0;
      for (var j = 0; j < left.length; j++) total += widths.current[j] || 0;
      if (total <= avail) n = left.length;
      else {
        var used = 0;
        for (var k = 0; k < left.length; k++) { var w = widths.current[k] || 0; if (used + w > avail - MORE_W) break; used += w; n++; }
      }
      setVisible(function (prev) { return prev === n ? prev : n; });
    }, [left.length]);
    React.useLayoutEffect(function () { fit(); });
    React.useEffect(function () {
      if (typeof ResizeObserver === 'undefined' || !bar.current) return;
      var ro = new ResizeObserver(function () { fit(); });
      ro.observe(bar.current);
      return function () { ro.disconnect(); };
    }, [fit]);
    React.useEffect(function () { if (visible >= left.length) setOpen(false); }, [visible, left.length]);
    React.useEffect(function () {
      if (!open) return;
      function onDoc(e) { if (moreRef.current && !moreRef.current.contains(e.target)) setOpen(false); }
      function onKey(e) { if (e.key === 'Escape') setOpen(false); }
      document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);
    var hidden = left.length - visible;
    return h('div', { ref: bar, className: cx('cy-status', props.overflowPlacement === 'bottom' && 'cy-status--menu-down', props.className), role: 'status', 'aria-label': props.label || 'Status' },
      h('div', { className: 'cy-status__side cy-status__side--left' },
        left.map(function (n, i) {
          return h('div', { key: i, ref: function (el) { segRefs.current[i] = el; }, className: 'cy-status__seg', hidden: i >= visible ? true : undefined }, n);
        }),
        hidden > 0 ? h('div', { ref: moreRef, className: 'cy-status__seg cy-status__more' },
          h(Button, { size: 'xs', variant: 'ghost', 'aria-expanded': open ? 'true' : 'false', 'aria-label': hidden + ' more status items', onClick: function () { setOpen(!open); } }, '+' + hidden),
          open ? h('div', { className: 'cy-status__overflow', role: 'group', 'aria-label': 'More status' },
            left.slice(visible).map(function (n, i) { return h('div', { key: i, className: 'cy-status__overflow-row' }, n); })) : null) : null),
      h('div', { ref: rightRef, className: 'cy-status__side cy-status__side--right' },
        right.map(function (n, i) { return h('div', { key: i, className: 'cy-status__seg' }, n); })));
  }

  /* ---------- Composer ---------- */
  function Composer(props) {
    var controlled = props.value !== undefined;
    var st = React.useState(props.defaultValue || ''), inner = st[0], setInner = st[1];
    var value = controlled ? props.value : inner;
    var ta = React.useRef(null);
    React.useLayoutEffect(function () {
      var el = ta.current; if (!el) return;
      el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
    }, [value]);
    function set(v) { if (!controlled) setInner(v); if (props.onChange) props.onChange(v); }
    var over = props.maxLength && value.length > props.maxLength;
    var canSend = value.trim().length > 0 && !over && !props.disabled;
    function submit() { if (!canSend || props.busy) return; if (props.onSubmit) props.onSubmit(value); if (!controlled) setInner(''); }
    return h('div', { className: cx('cy-composer', props.className) },
      h('textarea', { ref: ta, className: 'cy-composer__ta', rows: 2, value: value, placeholder: props.placeholder || 'Message',
        'aria-label': props.label || 'Message', disabled: props.disabled,
        onChange: function (e) { set(e.target.value); },
        onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } } }),
      h('div', { className: 'cy-composer__bar' },
        props.tools,
        h('span', { className: 'cy-composer__hint' },
          props.maxLength ? h('span', { className: cx('cy-composer__count', over && 'cy-composer__count--over') }, value.length + '/' + props.maxLength) : '⏎ Send · ⇧⏎ Newline'),
        props.busy
          ? h(Button, { size: 's', onClick: props.onStop }, 'Stop')
          : h(Button, { variant: 'primary', size: 's', onClick: submit, disabled: !canSend }, props.submitLabel || 'Send')));
  }

  /* ---------- Decoration ---------- */
  function AcidGround(props) {
    return h(props.as || 'div', { className: cx('cy-acid-ground', props.className), style: props.style }, props.children);
  }

  /* Stacked horizontal rules. With notch, the middle third of every bar drops by half a pitch. */
  function RuleStack(props) {
    var n = props.bars || 3, t = props.thickness || 8, g = props.gap === undefined ? 6 : props.gap;
    var notch = props.notch !== false, W = 300;
    var pitch = t + g, H = n * pitch - g + (notch ? Math.round(pitch / 2) : 0), rects = [];
    for (var i = 0; i < n; i++) {
      var y = i * pitch;
      if (notch) {
        rects.push(h('rect', { key: 'l' + i, x: 0, y: y, width: 100, height: t }));
        rects.push(h('rect', { key: 'm' + i, x: 100, y: y + Math.round(pitch / 2), width: 100, height: t }));
        rects.push(h('rect', { key: 'r' + i, x: 200, y: y, width: 100, height: t }));
      } else rects.push(h('rect', { key: i, x: 0, y: y, width: W, height: t }));
    }
    return h('svg', { className: cx('cy-rulestack', props.className), viewBox: '0 0 ' + W + ' ' + H, height: H, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, rects);
  }

  /* Wraps content with four plus-shaped registration marks at its corners. */
  function Registration(props) {
    return h('div', { className: cx('cy-reg', props.className), style: props.inset !== undefined ? { padding: props.inset } : undefined },
      ['tl', 'tr', 'bl', 'br'].map(function (k) { return h('span', { key: k, className: 'cy-reg__mark cy-reg__mark--' + k, 'aria-hidden': 'true' }); }),
      props.children);
  }

  /* Ruler strip: minor ticks every step, major every 5th, optional heavy blocks at given indexes. */
  function TickStrip(props) {
    var count = props.count || 60, step = 6, Hh = props.height || 24, heavy = props.heavy || [], rects = [];
    for (var i = 0; i < count; i++) {
      var major = i % 5 === 0, isHeavy = heavy.indexOf(i) >= 0;
      var hgt = isHeavy ? Hh : major ? Math.round(Hh * 0.75) : Math.round(Hh * 0.4);
      rects.push(h('rect', { key: i, x: i * step, y: Hh - hgt, width: isHeavy ? 4 : 2, height: hgt }));
    }
    return h('svg', { className: cx('cy-ticks', props.className), viewBox: '0 0 ' + (count * step) + ' ' + Hh, height: Hh, preserveAspectRatio: 'none', 'aria-hidden': 'true' }, rects);
  }

  var SEQ_WORD = { ok: 'OK', fail: 'FAIL', wait: '--' };
  function SequenceLog(props) {
    return h('div', { className: cx('cy-seq', props.className), role: 'log' },
      props.tag ? h('span', { className: 'cy-seq__tag' }, '[' + props.tag + ']') : null,
      h('ul', { className: 'cy-seq__list' }, (props.lines || []).map(function (ln, i) {
        var st = ln.status || 'ok';
        return h('li', { key: i, className: cx('cy-seq__row', ln.sub && 'cy-seq__row--sub') },
          h('span', { className: 'cy-seq__label' }, ln.label),
          ln.status === null ? null : h('span', { className: 'cy-seq__lead', 'aria-hidden': 'true' }),
          ln.status === null ? null : h('span', { className: 'cy-seq__status cy-seq__status--' + st }, ln.value || SEQ_WORD[st]));
      })),
      props.footer ? h('span', { className: 'cy-seq__foot' }, props.footer) : null);
  }

  function Slug(props) {
    var segs = props.segments || [];
    var parts = [];
    segs.forEach(function (s, i) { if (i) parts.push(h('span', { key: 's' + i, className: 'cy-slug__sep' }, ':')); parts.push(h('span', { key: i }, s)); });
    return h('div', { className: cx('cy-slug', props.className) },
      h('span', { className: 'cy-slug__code' }, parts),
      props.chips && props.chips.length ? h('span', { className: 'cy-slug__chips' }, props.chips.map(function (c, i) {
        var o = typeof c === 'string' ? { text: c } : c;
        return h('span', { key: i, className: cx('cy-slug__chip', o.solid && 'cy-slug__chip--solid') }, o.text);
      })) : null);
  }

  window.CyAc = { Button: Button, Field: Field, Tabs: Tabs, Panel: Panel, Badge: Badge, Readout: Readout, Loader: Loader, Message: Message, Thinking: Thinking, ToolCall: ToolCall, CodeBlock: CodeBlock, Composer: Composer, StatusBar: StatusBar, Metric: Metric, Menu: Menu, InputGroup: InputGroup, Input: Input, Addon: Addon, AcidGround: AcidGround, RuleStack: RuleStack, Registration: Registration, TickStrip: TickStrip, SequenceLog: SequenceLog, Slug: Slug };
})();
