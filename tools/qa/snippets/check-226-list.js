// 2.2.6 behaviour criteria (Vera's independent re-check).
// Deliberately selector-light: finds the switch by role="tab" + its labels, so a
// class rename does not move the goalposts. Returns numbers, not adjectives.
(async () => {
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const n = (v) => Math.round(v * 10) / 10;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: n(r.x), y: n(r.y), w: n(r.width), h: n(r.height), right: n(r.right), bottom: n(r.bottom) }; };
  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const until = async (fn, ms = 6000, step = 120) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await wait(step); } return false; };
  const out = { viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, checks: {} };

  // find the switch: tablist whose tabs are 按时间 / 按项目
  const tabs = qa('[role="tab"]');
  const listTabs = tabs.filter((t) => /按时间|按项目/.test(textOf(t)));
  const container = listTabs.length ? listTabs[0].parentElement : null;
  const thumb = container ? q('.tl-segmented-thumb', container) : null;

  out.switch = {
    found: listTabs.length,
    containerClass: container ? container.className : null,
    labels: listTabs.map(textOf),
    items: listTabs.map((t) => ({ label: textOf(t), box: box(t), selected: t.getAttribute('aria-selected') })),
    thumb: thumb ? { box: box(thumb), style: (() => { const s = getComputedStyle(thumb); return { 'background-color': s.backgroundColor, 'border-radius': s.borderRadius, 'box-shadow': s.boxShadow.slice(0, 60), 'transition-property': s.transitionProperty, 'transition-duration': s.transitionDuration, transform: s.transform }; })() } : null,
  };

  // 1 — thumb lands inside the second cell after a real click, and is as wide as it
  try {
    const second = listTabs[1];
    const first = listTabs[0];
    second.click();
    await until(() => second.getAttribute('aria-selected') === 'true', 2500);
    await wait(600); // 220–300ms animation + settle
    const tb = box(thumb);
    const cb = box(second);
    out.checks.thumbInCell = {
      pass: tb.x >= cb.x - 1 && tb.x <= cb.right + 1 && Math.abs(tb.w - cb.w) <= 1,
      thumbLeft: tb.x, cell: { left: cb.x, right: cb.right, width: cb.w },
      deltaLeft: n(tb.x - cb.x), widthDelta: n(tb.w - cb.w),
    };
    // and back, to prove it is state-driven rather than a one-way move
    first.click();
    await until(() => first.getAttribute('aria-selected') === 'true', 2500);
    await wait(600);
    const tb2 = box(thumb);
    const cb2 = box(first);
    out.checks.thumbBack = { pass: tb2.x >= cb2.x - 1 && tb2.x <= cb2.right + 1, thumbLeft: tb2.x, cellLeft: cb2.x, delta: n(tb2.x - cb2.x) };
  } catch (e) { out.checks.thumbInCell = { pass: false, error: String(e) }; }

  // 2 — one machine at a time: every platform node carries the same data-machine.
  //     No nodes = nothing measured, so the result is n/a, not a pass. A green
  //     cell must come from something that was actually observed.
  try {
    const nodes = qa('[data-machine]');
    const values = Array.from(new Set(nodes.map((el) => el.getAttribute('data-machine'))));
    out.checks.singleMachine = nodes.length === 0
      ? { pass: null, status: 'n/a', nodes: 0, note: 'platform/device nodes not landed — nothing measured' }
      : { pass: values.length <= 1, nodes: nodes.length, values };
  } catch (e) { out.checks.singleMachine = { pass: false, error: String(e) }; }

  // 3 — no horizontal overflow
  try {
    const doc = document.documentElement;
    const wide = qa('body *').filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !el.closest('[style*="overflow-x: auto"]') && !el.closest('.tl-code, pre'); }).slice(0, 5).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 40), right: n(el.getBoundingClientRect().right) }));
    out.checks.noOverflow = { pass: doc.scrollWidth <= innerWidth && wide.length === 0, scrollWidth: doc.scrollWidth, innerWidth, wide };
  } catch (e) { out.checks.noOverflow = { pass: false, error: String(e) }; }

  // 4 — reduced motion is honoured in the stylesheet (dynamic check lives in Rhea's CDP script)
  try {
    const rules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list; try { list = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(list || [])) {
        if (rule.conditionText && /prefers-reduced-motion/.test(rule.conditionText)) rules.push(rule.cssText.slice(0, 220));
      }
    }
    out.checks.reducedMotion = { pass: rules.length > 0, ruleCount: rules.length, sample: rules.slice(0, 2) };
  } catch (e) { out.checks.reducedMotion = { pass: false, error: String(e) }; }

  // 5 — the switch stays put while the list scrolls (the 2.2.5 defect).
  //     A run where the list never scrolled proves nothing: report it as FAIL
  //     (inconclusive), otherwise a short list would silently pass the gate.
  try {
    const sc = q('.tl-thread-scroll');
    if (!sc) throw new Error('no .tl-thread-scroll');
    await until(() => sc.scrollHeight > sc.clientHeight + 40, 6000);
    const before = thumb ? box(thumb) : (container ? box(container) : null);
    const room = sc.scrollHeight - sc.clientHeight;
    sc.scrollTop = Math.min(600, Math.max(0, room));
    await wait(350);
    const after = thumb ? box(thumb) : (container ? box(container) : null);
    const scrolled = sc.scrollTop;
    out.checks.pinnedWhileScroll = {
      pass: scrolled >= 100 && Boolean(after && after.bottom > 0 && after.y > 0),
      scrollTop: n(scrolled), room: n(room), before, after,
      containerInsideScroller: sc.contains(container),
      ...(scrolled < 100 ? { error: 'list did not scroll — cannot judge pinning' } : {}),
    };
    sc.scrollTop = 0; await wait(250);
  } catch (e) { out.checks.pinnedWhileScroll = { pass: false, error: String(e) }; }

  // 6 — the tap band around the item is >=44px tall, even though the drawn rail
  //     is shorter (App Store shape), and the band must not leave the track
  //     (UI_SPEC: ::before inset:-3px is allowed only while it stays inside).
  //     Both edges come from ONE 0.1px elementFromPoint scan: this headless
  //     Chromium reports box tops ~0.95px early, so comparing a scanned edge
  //     against a getBoundingClientRect() edge manufactures a 1px overflow and
  //     turns a correct implementation red (Rhea, 09:19). rect is reference only.
  try {
    const item = listTabs[0];
    const r = item.getBoundingClientRect();
    const track = container.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const EPS = 0.1;
    const scan = (matches) => {
      let first = null, last = null;
      for (let y = track.top - 12; y <= track.bottom + 12; y = Math.round((y + EPS) * 10000) / 10000) {
        const el = document.elementFromPoint(cx, y);
        if (el && matches(el)) { if (first === null) first = Math.round(y * 10) / 10; last = Math.round(y * 10) / 10; }
      }
      return { first, last };
    };
    const killPseudo = document.createElement('style');
    killPseudo.textContent = '[role="tab"]::before{content:none!important}';
    document.head.appendChild(killPseudo);
    const trackHit = scan((el) => el === container || container.contains(el));
    killPseudo.remove();
    const bandHit = scan((el) => { const tab = el.closest && el.closest('[role="tab"]'); return Boolean(tab) && textOf(tab) === textOf(item); });
    const bandHeight = bandHit.first === null ? 0 : Math.round((bandHit.last - bandHit.first + EPS) * 10) / 10;
    const insideTrack = bandHit.first !== null && trackHit.first !== null && bandHit.first >= trackHit.first - 0.05 && bandHit.last <= trackHit.last + 0.05;
    out.checks.tapBand = {
      pass: bandHeight >= 44 && insideTrack,
      bandHeight, bandTop: bandHit.first, bandBottom: bandHit.last,
      trackTop: trackHit.first, trackBottom: trackHit.last,
      drawnHeight: n(r.height), rect: { top: n(track.top), bottom: n(track.bottom), height: n(track.height) },
      insideTrack,
      note: 'band and track edges measured with the same 0.1px scan; rect edges are reference only',
    };
  } catch (e) { out.checks.tapBand = { pass: false, error: String(e) }; }

  // 7 — compact and centred (UI_SPEC 2.2.6): cell >= 88, total 180–200, centred ±1
  try {
    const boxes = listTabs.map((t) => t.getBoundingClientRect());
    const total = boxes.reduce((sum, b) => sum + b.width, 0);
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.right));
    const centreOffset = (left + right) / 2 - innerWidth / 2;
    out.checks.compactCentred = {
      pass: boxes.every((b) => b.width >= 88) && total >= 180 && total <= 200 && Math.abs(centreOffset) <= 1,
      cells: boxes.map((b) => n(b.width)), total: n(total), centreOffset: n(centreOffset),
      spec: 'cell >= 88, total 180–200, centred',
    };
  } catch (e) { out.checks.compactCentred = { pass: false, error: String(e) }; }

  // 8 — device page: only the active machine may render platform nodes, so every
  //     [data-machine] on screen must carry the same value (none = n/a again).
  try {
    const deviceTab = qa('.tl-tabbar [aria-label], .tl-tabbar button').find((n) => /设备/.test(textOf(n)) || /设备/.test(n.getAttribute('aria-label') || ''));
    out.devicePage = { tabFound: Boolean(deviceTab) };
    if (deviceTab) {
      deviceTab.click();
      await wait(900);
      const nodes = qa('[data-machine]');
      const values = Array.from(new Set(nodes.map((el) => el.getAttribute('data-machine'))));
      out.devicePage.text = (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 500);
      out.devicePage.machineNodes = nodes.length;
      out.devicePage.values = values;
      const machineCards = qa('.tl-devcard').length;
      out.devicePage.machineCards = machineCards;
      out.checks.singleMachine = nodes.length === 0
        ? { pass: null, status: 'n/a', nodes: 0, note: 'device page reachable but renders no [data-machine] node' }
        : machineCards < 2
          ? { pass: null, status: 'n/a', nodes: nodes.length, values, machineCards, note: 'fewer than two machines on screen — one value cannot fail, so no green' }
          : { pass: values.length <= 1, nodes: nodes.length, values, machineCards };
      // back to the list so a later screenshot/label does not inherit this page
      const listTab = qa('.tl-tabbar [aria-label], .tl-tabbar button').find((n) => /会话/.test(textOf(n)) || /会话/.test(n.getAttribute('aria-label') || ''));
      if (listTab) { listTab.click(); await wait(500); }
    }
  } catch (e) { out.devicePage = { error: String(e) }; }

  out.summary = Object.fromEntries(Object.entries(out.checks).map(([k, v]) => [k, v.pass === null ? 'N/A' : (v.pass ? 'PASS' : 'FAIL')]));
  return out;
})()
