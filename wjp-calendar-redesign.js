/* wjp-calendar-redesign.js v3.1 — comment-in-concat NaN fix.
 * v1: dense grid + filter chips + notes/reminders + late-fee dots
 * v2: parse bullet-less Payday/INCOME rows
 * v3: heatmap toggle, Month/Quarter view, payday accent lines, smart
 *     suggestion banner, .ics export, drag-to-reschedule with localStorage
 *     overrides, squeeze forecast (running balance) per day, what-if hint
 *     while dragging.
 *
 * Data: harvested from the original "Coming Up" event rows on the page.
 * Hides the old broken grid + sidebar + oversized hero, then renders our
 * own UI into a sibling element. Hardened pattern: IIFE, idempotent,
 * path-guarded to /index.html, no MutationObservers, polled.
 */
(function () {
  "use strict";
  if (window._wjpCalRedesignInstalled) return;
  window._wjpCalRedesignInstalled = true;

  try {
    var p = (location.pathname || "").toLowerCase();
    if (p.indexOf("/index") === -1 && p !== "/" && p !== "") return;
  } catch (_) {}

  var ROOT_ID       = "wjp-cal-root";
  var LS_NOTES      = "wjp.cal.notes.v1";
  var LS_FILTER     = "wjp.cal.filter.v1";
  var LS_VIEW       = "wjp.cal.view.v1";       // "month" | "quarter"
  var LS_HEATMAP    = "wjp.cal.heatmap.v1";    // "1" | "0"
  var LS_OVERRIDES  = "wjp.cal.overrides.v1";  // {origDate+name: newDate}
  var LS_BALANCE    = "wjp.cal.balance.v1";    // starting balance for forecast
  var MONTHS_FULL   = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var MONTHS_SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DAYS          = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

  var state = {
    viewMonth:    new Date().getMonth(),
    viewYear:     new Date().getFullYear(),
    filter:       "all",
    selectedDate: null,
    view:         "month",
    heatmap:      false,
    dragging:     null  // {fromDate, name}
  };
  try { state.filter  = localStorage.getItem(LS_FILTER)  || "all"; }    catch (_) {}
  try { state.view    = localStorage.getItem(LS_VIEW)    || "month"; }  catch (_) {}
  try { state.heatmap = localStorage.getItem(LS_HEATMAP) === "1"; }     catch (_) {}

  // === Storage ============================================================
  function loadJSON(k, def) {
    try { return JSON.parse(localStorage.getItem(k) || "null") || def; }
    catch (_) { return def; }
  }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

  function loadNotes()      { return loadJSON(LS_NOTES, {}); }
  function saveNotes(o)     { saveJSON(LS_NOTES, o); }
  function loadOverrides()  { return loadJSON(LS_OVERRIDES, {}); }
  function saveOverrides(o) { saveJSON(LS_OVERRIDES, o); }
  function loadStartBalance() {
    var v = parseFloat(localStorage.getItem(LS_BALANCE));
    return isFinite(v) ? v : null;
  }
  function saveStartBalance(v) { try { localStorage.setItem(LS_BALANCE, String(v)); } catch (_) {} }

  function setNote(date, text, reminderAt) {
    var o = loadNotes();
    if (!text && !reminderAt) delete o[date];
    else o[date] = { text: text || "", reminderAt: reminderAt || null, fired: false };
    saveNotes(o);
  }

  // Browser-notification reminders (existing notes only)
  var lastReminderCheck = 0;
  function checkReminders() {
    if (Date.now() - lastReminderCheck < 30000) return;
    lastReminderCheck = Date.now();
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    var notes = loadNotes(); var now = Date.now();
    Object.keys(notes).forEach(function (date) {
      var n = notes[date];
      if (!n || !n.reminderAt || n.fired) return;
      if (now >= n.reminderAt) {
        try {
          new Notification("WJP reminder · " + date, { body: n.text || "(no note)" });
          n.fired = true; saveNotes(notes);
        } catch (_) {}
      }
    });
  }

  // === Data harvest =======================================================
  function harvestEvents() {
    var events = [];
    var page = document.getElementById("page-recurring");
    if (!page) return events;
    var candidates = Array.from(page.querySelectorAll("div")).filter(function (el) {
      return el.children.length >= 10 && el.children.length <= 80
          && (el.textContent || "").indexOf("$") !== -1;
    });
    var container = null;
    for (var i = 0; i < candidates.length; i++) {
      var sample = (candidates[i].children[0].textContent || "").replace(/\s+/g, " ").trim();
      if (/[A-Z]{3}\s*\d{1,2}/.test(sample) && /\$/.test(sample)) {
        container = candidates[i]; break;
      }
    }
    if (!container) return events;

    var monthIdx = {};
    ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
      .forEach(function (m, i) { monthIdx[m] = i; });
    var nowYear = new Date().getFullYear();
    var nowMonth = new Date().getMonth();

    Array.from(container.children).forEach(function (row) {
      var txt = (row.textContent || "").replace(/\s+/g, " ").trim();
      var m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s*[•·]\s*(\w[\w\s/-]*?)\s+(OVERDUE|PAID|DUE\s*\d+D|IN\s*\d+D|INCOME|UPCOMING|PENDING)$/i);
      if (!m) m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s*[•·]\s*(\w[\w\s/-]*)$/i);
      if (!m) {
        m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)\s+(OVERDUE|PAID|DUE\s*\d+D|IN\s*\d+D|INCOME|UPCOMING|PENDING)$/i);
        if (m) m = [m[0], m[1], m[2], m[3], m[4], m[5].toLowerCase(), m[5]];
      }
      if (!m) {
        m = txt.match(/^([A-Z]{3})\s*(\d{1,2})\s+(.+?)\s+\$([\d,]+(?:\.\d+)?)$/i);
        if (m) m = [m[0], m[1], m[2], m[3], m[4], "recurring", ""];
      }
      if (!m) return;
      var mo = monthIdx[m[1].toUpperCase()]; if (mo == null) return;
      var d = parseInt(m[2], 10);
      var yr = nowYear; if (mo < nowMonth - 6) yr += 1;
      var name = m[3].trim();
      var amt = parseFloat(m[4].replace(/,/g, ""));
      var type = (m[5] || "").toLowerCase().trim();
      var status = (m[6] || "").toUpperCase().trim();
      var origDate = yr + "-" + String(mo + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var overrides = loadOverrides();
      var ovKey = origDate + "|" + name;
      var date = overrides[ovKey] || origDate;
      var moved = !!overrides[ovKey];
      events.push({
        date: date,
        origDate: origDate,
        name: name,
        amount: amt,
        type: type,
        status: status,
        category: categorize(name, type),
        moved: moved,
        ovKey: ovKey
      });
    });
    return events;
  }

  function categorize(name, type) {
    var s = (name + " " + type).toLowerCase();
    if (/payday|income|deposit|paycheck/.test(s)) return "income";
    if (/insur|coverage/.test(s)) return "insurance";
    if (/util|electric|gas|water|internet|power|phone/.test(s)) return "utility";
    if (/subscrip|netflix|spotify|claude|chatgpt|disney|hulu|prime|gym|adobe/.test(s)) return "subscription";
    if (/loan|card|credit|brightway|sofi|capital|avant|milestone|affirm|klarna|aidadvantage|westlake|account|debt/.test(s)) return "debt";
    return "other";
  }

  function categoryStyle(cat) {
    switch (cat) {
      case "debt":         return { color: "#dc2626", bg: "rgba(220,38,38,0.10)", border: "rgba(220,38,38,0.25)" };
      case "subscription": return { color: "#7c3aed", bg: "rgba(124,58,237,0.10)", border: "rgba(124,58,237,0.25)" };
      case "utility":      return { color: "#0284c7", bg: "rgba(2,132,199,0.10)", border: "rgba(2,132,199,0.25)" };
      case "insurance":    return { color: "#c99a2a", bg: "rgba(201,154,42,0.12)", border: "rgba(201,154,42,0.30)" };
      case "income":       return { color: "#1f7a4a", bg: "rgba(31,122,74,0.12)", border: "rgba(31,122,74,0.30)" };
      default:             return { color: "#6b7280", bg: "rgba(107,114,128,0.10)", border: "rgba(107,114,128,0.20)" };
    }
  }

  // === Helpers ============================================================
  function fmtUSD(n) {
    if (!isFinite(n) || n == null) return "—";
    return "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
  }
  function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"\']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "\'": "&#39;" })[c];
    });
  }
  function isOverdue(ev) {
    if (ev.status === "OVERDUE") return true;
    if (ev.status === "PAID") return false;
    var todayK = dateKey(new Date());
    return ev.date < todayK && ev.category !== "income";
  }

  // === Squeeze forecast: running balance per day =========================
  function computeRunningBalance(events, fromDate, daysOut) {
    var start = loadStartBalance();
    if (start == null) return null;
    var dayMap = {};
    events.forEach(function (e) {
      if (!dayMap[e.date]) dayMap[e.date] = 0;
      dayMap[e.date] += (e.category === "income" ? e.amount : -e.amount);
    });
    var balanceByDate = {};
    var bal = start;
    var d = new Date(fromDate + "T12:00:00");
    for (var i = 0; i < daysOut; i++) {
      var k = dateKey(d);
      bal += (dayMap[k] || 0);
      balanceByDate[k] = bal;
      d.setDate(d.getDate() + 1);
    }
    return balanceByDate;
  }

  // === ICS export =========================================================
  function eventsToICS(events) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//WJP Debt Tracking//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:WJP Payments"
    ];
    function pad(n) { return String(n).padStart(2, "0"); }
    function dtstamp(d) {
      return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
             "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
    }
    function escapeText(s) {
      return String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
    }
    var now = dtstamp(new Date());
    events.forEach(function (e, i) {
      var d = e.date.replace(/-/g, "");
      var nextDay = new Date(e.date + "T00:00:00");
      nextDay.setDate(nextDay.getDate() + 1);
      var dEnd = dateKey(nextDay).replace(/-/g, "");
      var summary = "$" + Math.round(e.amount).toLocaleString("en-US") + " " + e.name;
      lines.push("BEGIN:VEVENT");
      lines.push("UID:wjp-" + i + "-" + e.date + "@wjpdebttracking.com");
      lines.push("DTSTAMP:" + now);
      lines.push("DTSTART;VALUE=DATE:" + d);
      lines.push("DTEND;VALUE=DATE:" + dEnd);
      lines.push("SUMMARY:" + escapeText(summary));
      lines.push("DESCRIPTION:" + escapeText(e.category + " · " + (e.type || "") + (e.status ? " · " + e.status : "")));
      lines.push("CATEGORIES:" + e.category.toUpperCase());
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }
  function downloadICS(events) {
    var ics = eventsToICS(events);
    var blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "wjp-payments-" + dateKey(new Date()) + ".ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {} }, 800);
  }

  // === Smart suggestions =================================================
  // Find non-income events that fall within 3 days BEFORE a payday — those
  // are cash-crunch risks. Suggest moving to just AFTER payday.
  function buildSuggestions(events) {
    var paydays = events.filter(function (e) { return e.category === "income"; })
                        .map(function (e) { return e.date; }).sort();
    if (!paydays.length) return [];
    var suggestions = [];
    events.forEach(function (e) {
      if (e.category === "income") return;
      var t = new Date(e.date + "T12:00:00").getTime();
      paydays.forEach(function (pd) {
        var pt = new Date(pd + "T12:00:00").getTime();
        var deltaDays = Math.round((pt - t) / 86400000);
        if (deltaDays > 0 && deltaDays <= 3 && e.amount >= 50) {
          suggestions.push({
            event: e,
            payday: pd,
            deltaDays: deltaDays,
            message: "Move " + e.name + " from " + e.date + " to just after " + pd + " — avoid " + deltaDays + " day" + (deltaDays === 1 ? "" : "s") + " of cash crunch."
          });
        }
      });
    });
    suggestions.sort(function (a, b) { return b.event.amount - a.event.amount; });
    return suggestions.slice(0, 2);
  }

  // === Render =============================================================
  function findHost() {
    var page = document.getElementById("page-recurring");
    if (!page || !page.classList.contains("active")) return null;
    return page;
  }
  function hideOriginalContent(page) {
    Array.from(page.children).forEach(function (c) {
      if (c.id === ROOT_ID) return;
      if (c.dataset && c.dataset.wjpCalHidden === "1") return;
      c.dataset.wjpCalHidden = "1";
      c.style.display = "none";
    });
  }

  function ensureStyle() {
    if (document.getElementById("wjp-cal-styles")) return;
    var s = document.createElement("style");
    s.id = "wjp-cal-styles";
    s.textContent = [
      ".wjp-cal-cell { min-height:96px; padding:6px 8px; border-right:1px solid rgba(0,0,0,0.05); cursor:pointer; transition:background .15s; position:relative; }",
      ".wjp-cal-cell:hover { background: rgba(0,0,0,0.025); }",
      ".wjp-cal-today { background: rgba(31,122,74,0.04); }",
      ".wjp-cal-today.wjp-cal-cell:hover { background: rgba(31,122,74,0.08); }",
      ".wjp-cal-payday-col::before { content:''; position:absolute; left:0; top:6px; bottom:6px; width:2px; background:#1f7a4a; border-radius:2px; opacity:0.55; pointer-events:none; }",
      ".wjp-cal-cell[draggable] { cursor:grab; }",
      ".wjp-cal-chip[draggable] { cursor:grab; }",
      ".wjp-cal-chip[draggable]:active { cursor:grabbing; }",
      ".wjp-cal-cell.wjp-cal-drop-target { background: rgba(31,122,74,0.15) !important; outline: 2px dashed #1f7a4a; outline-offset: -3px; }",
      ".wjp-cal-quarter-cell { min-height:54px !important; padding:4px 5px !important; }",
      ".wjp-cal-quarter-cell .wjp-cal-chip { font-size:9px !important; padding:1px 4px !important; }",
      ".wjp-cal-quarter-cell .wjp-cal-day-num { font-size:10px !important; }",
      "@keyframes wjpPulse { 0%,100% { opacity:.65 } 50% { opacity:1 } }",
      ".wjp-cal-suggestion-pulse { animation: wjpPulse 2.4s ease-in-out infinite; }"
    ].join("\n");
    document.head.appendChild(s);
  }

  // === HTML builders ======================================================
  function chipHTML(e, draggable, compact) {
    var s = categoryStyle(e.category);
    var tip = e.name + " · " + fmtUSD(e.amount) + (e.status ? " · " + e.status : "");
    var moved = e.moved ? '<span title="moved" style="margin-left:4px;color:#c99a2a;font-weight:800;">↻</span>' : "";
    var sz = compact ? "font-size:9px;padding:1px 4px;margin-bottom:1px;" : "font-size:10px;padding:2px 6px;margin-bottom:2px;";
    return '<div class="wjp-cal-chip" '
      + (draggable ? 'draggable="true" data-cal-drag-name="' + escapeHTML(e.name) + '" data-cal-drag-orig="' + e.origDate + '" data-cal-drag-cur="' + e.date + '" ' : "")
      + 'title="' + escapeHTML(tip) + '" '
      + 'style="' + sz + 'background:' + s.bg + ';color:' + s.color + ';border-radius:4px;border:1px solid ' + s.border + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;letter-spacing:-0.005em;">'
      + escapeHTML(e.name) + moved
      + '</div>';
  }

  function buildMonthGrid(events, year, month, opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var notes = loadNotes();
    var first = new Date(year, month, 1);
    var startDay = first.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var todayKey = dateKey(new Date());

    // Group events by date (after override remap)
    var byDate = {};
    events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    // Paydays this month (column accent)
    var paydayDays = {};
    events.forEach(function (e) {
      if (e.category === "income" && e.date.startsWith(year + "-" + String(month + 1).padStart(2, "0"))) {
        paydayDays[parseInt(e.date.slice(8, 10), 10)] = true;
      }
    });

    // Squeeze forecast (only in month view)
    var balances = null;
    if (state.view === "month") {
      var firstK = year + "-" + String(month + 1).padStart(2, "0") + "-01";
      balances = computeRunningBalance(events, firstK, daysInMonth);
    }

    // Heatmap intensity
    var dayOut = {};
    var maxOut = 0;
    Object.keys(byDate).forEach(function (k) {
      var sum = byDate[k].reduce(function (s, e) { return s + (e.category === "income" ? 0 : e.amount); }, 0);
      dayOut[k] = sum;
      if (sum > maxOut) maxOut = sum;
    });

    var cells = [];
    for (var i = 0; i < startDay; i++) cells.push({ blank: true });
    for (var d = 1; d <= daysInMonth; d++) {
      var k = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      cells.push({
        date: k, day: d, events: byDate[k] || [],
        isToday: k === todayKey,
        note: notes[k] || null,
        isPaydayCol: !!paydayDays[d],
        balance: balances ? balances[k] : null
      });
    }
    while (cells.length % 7) cells.push({ blank: true });

    var weeks = [];
    for (var w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));

    var html = '<div style="border:1px solid rgba(0,0,0,0.08);border-radius:14px;overflow:hidden;background:#fff;">';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);background:rgba(0,0,0,0.025);">';
    DAYS.forEach(function (label) {
      html += '<div style="padding:' + (compact ? "5px 6px" : "8px 10px") + ';font-size:' + (compact ? "8.5px" : "9.5px") + ';letter-spacing:0.14em;font-weight:700;color:#9ca3af;text-align:left;border-right:1px solid rgba(0,0,0,0.05);">' + label + '</div>';
    });
    html += "</div>";

    weeks.forEach(function (week) {
      html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid rgba(0,0,0,0.05);">';
      week.forEach(function (cell) {
        if (cell.blank) {
          html += '<div style="' + (compact ? "min-height:54px;" : "min-height:96px;") + 'background:rgba(0,0,0,0.015);border-right:1px solid rgba(0,0,0,0.05);"></div>';
          return;
        }
        var total = (cell.events || []).reduce(function (s, e) { return s + (e.category === "income" ? 0 : e.amount); }, 0);
        var hasOverdue = (cell.events || []).some(isOverdue);
        // Heatmap tint
        var bg = "";
        if (state.heatmap && total > 0 && maxOut > 0) {
          var intensity = Math.min(1, total / maxOut);
          // red gradient — soft to strong
          bg = "background:rgba(220,38,38," + (0.06 + intensity * 0.32).toFixed(2) + ");";
        }
        var dayHeader = ""
          + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:' + (compact ? "2px" : "4px") + ';">'
          +   '<span class="wjp-cal-day-num" style="font-size:' + (compact ? "10px" : "11.5px") + ';font-weight:700;color:' + (cell.isToday ? "#fff" : "#0a0a0a") + ';'
          +     (cell.isToday ? "background:#1f7a4a;width:" + (compact ? "16px" : "20px") + ";height:" + (compact ? "16px" : "20px") + ";border-radius:50%;display:inline-flex;align-items:center;justify-content:center;" : "")
          +   '">' + cell.day + '</span>'
          +   '<span style="display:inline-flex;align-items:center;gap:4px;">'
          +     (cell.note ? '<span title="Has note" style="width:5px;height:5px;border-radius:50%;background:#c99a2a;"></span>' : "")
          +     (hasOverdue ? '<span title="Overdue/late" style="width:6px;height:6px;border-radius:50%;background:#dc2626;"></span>' : "")
          +     (total > 0 && !compact ? '<span style="font-size:9.5px;color:#6b7280;font-weight:700;">' + fmtUSD(total) + '</span>' : "")
          +   '</span>'
          + '</div>';
        var chipsHTML = "";
        var visible = (cell.events || []).slice(0, compact ? 2 : 3);
        visible.forEach(function (e) { chipsHTML += chipHTML(e, !compact, compact); });
        var more = (cell.events || []).length - visible.length;
        if (more > 0) chipsHTML += '<div style="font-size:' + (compact ? "8.5px" : "9.5px") + ';color:#9ca3af;font-weight:700;">+' + more + ' more</div>';

        // Squeeze forecast bar
        var balLine = "";
        if (cell.balance != null) {
          var negative = cell.balance < 0;
          balLine = '<div style="position:absolute;left:6px;right:6px;bottom:4px;font-size:9px;font-weight:700;color:' + (negative ? "#dc2626" : "#1f7a4a") + ';letter-spacing:-0.005em;text-align:right;opacity:.85;">' + (negative ? "−" : "") + fmtUSD(cell.balance) + '</div>';
        }

        var classes = "wjp-cal-cell" + (cell.isToday ? " wjp-cal-today" : "")
          + (cell.isPaydayCol ? " wjp-cal-payday-col" : "")
          + (compact ? " wjp-cal-quarter-cell" : "");
        html += '<div data-cal-day="' + cell.date + '" class="' + classes + '" style="' + bg + '">'
          + dayHeader + chipsHTML + balLine + '</div>';
      });
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function buildFiltersAndSummary(events) {
    var monthEvents = events.filter(function (e) {
      return e.date.startsWith(state.viewYear + "-" + String(state.viewMonth + 1).padStart(2, "0"));
    });
    var monthOut = 0, monthIn = 0;
    monthEvents.forEach(function (e) {
      if (e.category === "income") monthIn += e.amount; else monthOut += e.amount;
    });

    var FILTERS = [
      { k: "all",          label: "All",         count: events.length },
      { k: "debt",         label: "Debts",       count: events.filter(function(e){return e.category==="debt";}).length },
      { k: "subscription", label: "Subs",        count: events.filter(function(e){return e.category==="subscription";}).length },
      { k: "utility",      label: "Utilities",   count: events.filter(function(e){return e.category==="utility";}).length },
      { k: "insurance",    label: "Insurance",   count: events.filter(function(e){return e.category==="insurance";}).length },
      { k: "income",       label: "Income",      count: events.filter(function(e){return e.category==="income";}).length }
    ];

    var html = ""
      + '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">'
      +   '<div>'
      +     '<div style="font-size:10.5px;letter-spacing:0.16em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:4px;">Calendar</div>'
      +     '<div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;">'
      +       '<span data-cal-prev style="cursor:pointer;color:#9ca3af;padding:0 6px;user-select:none;">‹</span>'
      +       (state.view === "quarter"
                 ? "Quarter starting " + MONTHS_SHORT[state.viewMonth] + " " + state.viewYear
                 : MONTHS_FULL[state.viewMonth] + " " + state.viewYear)
      +       '<span data-cal-next style="cursor:pointer;color:#9ca3af;padding:0 6px;user-select:none;">›</span>'
      +     '</div>'
      +   '</div>'
      +   '<div style="display:flex;gap:14px;align-items:center;font-size:12px;color:#6b7280;flex-wrap:wrap;">'
      +     '<span>Out: <b style="color:#dc2626;">' + fmtUSD(monthOut) + '</b></span>'
      +     '<span>In: <b style="color:#1f7a4a;">' + fmtUSD(monthIn) + '</b></span>'
      +     '<span>Net: <b style="color:' + ((monthIn-monthOut) >= 0 ? "#1f7a4a" : "#dc2626") + ';">' + fmtUSD(monthIn-monthOut) + '</b></span>'
      +     '<div style="display:inline-flex;background:rgba(0,0,0,0.05);border-radius:999px;padding:2px;">'
      +       '<button type="button" data-cal-view="month" style="border:0;background:' + (state.view==="month"?"#0a0a0a":"transparent") + ';color:' + (state.view==="month"?"#fff":"#6b7280") + ';font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;">Month</button>'
      +       '<button type="button" data-cal-view="quarter" style="border:0;background:' + (state.view==="quarter"?"#0a0a0a":"transparent") + ';color:' + (state.view==="quarter"?"#fff":"#6b7280") + ';font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;">Quarter</button>'
      +     '</div>'
      +     '<button type="button" data-cal-heatmap style="border:1px solid ' + (state.heatmap ? "#dc2626" : "rgba(0,0,0,0.10)") + ';background:' + (state.heatmap ? "rgba(220,38,38,0.08)" : "transparent") + ';color:' + (state.heatmap ? "#dc2626" : "#6b7280") + ';font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;">Heatmap</button>'
      +     '<button type="button" data-cal-export style="border:1px solid rgba(0,0,0,0.10);background:#fff;color:#0a0a0a;font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:4px;">↓ .ics</button>'
      +     '<button type="button" data-cal-balance style="border:1px solid rgba(0,0,0,0.10);background:#fff;color:#0a0a0a;font-size:11px;padding:5px 12px;border-radius:999px;font-weight:700;cursor:pointer;font-family:inherit;">Set balance</button>'
      +   '</div>'
      + '</div>';

    // filter chips
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">';
    FILTERS.forEach(function (f) {
      var active = state.filter === f.k;
      var cs = f.k === "all" ? { color: "#0a0a0a", bg: "rgba(0,0,0,0.06)", border: "rgba(0,0,0,0.10)" } : categoryStyle(f.k);
      html += '<button type="button" data-cal-filter="' + f.k + '" '
        + 'style="border:1px solid ' + (active ? cs.color : cs.border) + ';'
        + 'background:' + (active ? cs.color : cs.bg) + ';'
        + 'color:' + (active ? "#fff" : cs.color) + ';'
        + 'padding:5px 11px;border-radius:999px;font-size:11.5px;font-weight:700;'
        + 'letter-spacing:-0.005em;cursor:pointer;font-family:inherit;'
        + 'display:inline-flex;align-items:center;gap:6px;">'
        + escapeHTML(f.label)
        + '<span style="font-weight:600;opacity:.7;">' + f.count + '</span>'
        + '</button>';
    });
    html += "</div>";
    return html;
  }

  function buildSuggestionBanner(events) {
    var sugs = buildSuggestions(events);
    if (!sugs.length) return "";
    var s = sugs[0];
    return '<div class="wjp-cal-suggestion-pulse" style="border:1px solid rgba(31,122,74,0.30);background:linear-gradient(135deg,rgba(31,122,74,0.06),rgba(201,154,42,0.04));border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;font-family:var(--sans,Inter,system-ui,sans-serif);">'
      + '<span style="font-size:18px;">💡</span>'
      + '<div style="flex:1;font-size:12.5px;color:#0a0a0a;line-height:1.45;">'
      +   '<b>Smart suggestion:</b> ' + escapeHTML(s.message)
      + '</div>'
      + '<button type="button" data-cal-sug-dismiss style="background:transparent;border:0;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1;">×</button>'
      + '</div>';
  }

  function renderDayPanel(date, events, note) {
    var dt = new Date(date + "T12:00:00");
    var pretty = dt.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    var html = ""
      + '<div id="wjp-cal-day-panel" style="margin-top:18px;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:14px;padding:18px 20px;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">'
      +   '<div style="font-size:14.5px;font-weight:700;letter-spacing:-0.01em;">' + pretty + '</div>'
      +   '<button type="button" data-cal-close style="background:transparent;border:0;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1;">×</button>'
      + '</div>';
    if (events.length) {
      html += '<div style="display:grid;gap:6px;margin-bottom:16px;">';
      events.forEach(function (e) {
        var s = categoryStyle(e.category);
        html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;background:' + s.bg + ';border:1px solid ' + s.border + ';border-radius:8px;">'
          + '<div style="display:flex;flex-direction:column;line-height:1.25;">'
          +   '<span style="font-size:12.5px;font-weight:700;color:#0a0a0a;">' + escapeHTML(e.name) + (e.moved ? ' <span style="color:#c99a2a;font-weight:800;" title="moved">↻</span>' : "") + '</span>'
          +   '<span style="font-size:10.5px;color:#6b7280;font-weight:600;">' + escapeHTML(e.type) + (e.status ? " · " + escapeHTML(e.status) : "") + '</span>'
          + '</div>'
          + '<span style="font-size:13px;font-weight:800;color:' + s.color + ';">' + fmtUSD(e.amount) + '</span>'
          + '</div>';
      });
      html += "</div>";
    } else {
      html += '<div style="font-size:12.5px;color:#9ca3af;margin-bottom:16px;">No payments scheduled.</div>';
    }
    var noteText = note ? note.text : "";
    var reminderAt = note && note.reminderAt ? new Date(note.reminderAt) : null;
    var reminderVal = reminderAt ? reminderAt.toISOString().slice(0, 16) : "";
    html += '<div style="border-top:1px solid rgba(0,0,0,0.06);padding-top:14px;">'
      + '<div style="font-size:10.5px;letter-spacing:0.10em;text-transform:uppercase;color:#9ca3af;font-weight:700;margin-bottom:8px;">Your note</div>'
      + '<textarea data-cal-note placeholder="Add a note for this day…" rows="3" style="width:100%;padding:10px 12px;border:1px solid rgba(0,0,0,0.12);border-radius:8px;font-family:inherit;font-size:13px;color:#0a0a0a;resize:vertical;background:#fff;">' + escapeHTML(noteText) + '</textarea>'
      + '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap;">'
      +   '<label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:#6b7280;font-weight:600;">'
      +     'Remind me at:'
      +     '<input type="datetime-local" data-cal-reminder value="' + reminderVal + '" style="border:1px solid rgba(0,0,0,0.12);border-radius:6px;padding:5px 8px;font-family:inherit;font-size:12px;">'
      +   '</label>'
      +   '<button type="button" data-cal-save style="background:#1f7a4a;color:#fff;border:0;padding:7px 16px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>'
      +   (note ? '<button type="button" data-cal-delete style="background:transparent;color:#dc2626;border:1px solid rgba(220,38,38,0.30);padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Delete</button>' : "")
      +   '<span style="font-size:10.5px;color:#9ca3af;flex:1;text-align:right;">Reminders use browser notifications · click to allow</span>'
      + '</div>'
      + '</div>'
      + '</div>';
    return html;
  }

  function buildHTML(events) {
    var html = '<div style="font-family:var(--sans,Inter,system-ui,sans-serif);color:var(--ink,#0a0a0a);padding:18px 0 24px;">';
    html += buildSuggestionBanner(events);
    html += buildFiltersAndSummary(events);

    // Filter events for grid
    var filtered = state.filter === "all" ? events : events.filter(function (e) { return e.category === state.filter; });

    if (state.view === "quarter") {
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">';
      for (var i = 0; i < 3; i++) {
        var m = state.viewMonth + i;
        var y = state.viewYear; while (m > 11) { m -= 12; y++; }
        html += '<div>'
          + '<div style="font-size:13px;font-weight:700;letter-spacing:-0.005em;margin-bottom:6px;color:#0a0a0a;">' + MONTHS_FULL[m] + ' ' + y + '</div>'
          + buildMonthGrid(filtered, y, m, { compact: true })
          + '</div>';
      }
      html += "</div>";
    } else {
      html += buildMonthGrid(filtered, state.viewYear, state.viewMonth, { compact: false });
    }

    if (state.selectedDate) {
      var sel = state.selectedDate;
      var selEvents = (events || []).filter(function (e) { return e.date === sel; });
      var selNote = loadNotes()[sel] || null;
      html += renderDayPanel(sel, selEvents, selNote);
    }
    html += "</div>";
    return html;
  }

  // === Drag/drop ==========================================================
  function attachDragHandlers(host) {
    Array.from(host.querySelectorAll(".wjp-cal-chip[draggable]")).forEach(function (chip) {
      chip.addEventListener("dragstart", function (e) {
        try {
          state.dragging = {
            origDate: chip.dataset.calDragOrig,
            curDate:  chip.dataset.calDragCur,
            name:     chip.dataset.calDragName
          };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", chip.dataset.calDragName);
        } catch (_) {}
      });
      chip.addEventListener("dragend", function () { state.dragging = null;
        Array.from(host.querySelectorAll(".wjp-cal-drop-target")).forEach(function (n) { n.classList.remove("wjp-cal-drop-target"); });
      });
    });
    Array.from(host.querySelectorAll(".wjp-cal-cell[data-cal-day]")).forEach(function (cell) {
      cell.addEventListener("dragover", function (e) {
        if (!state.dragging) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
        cell.classList.add("wjp-cal-drop-target");
      });
      cell.addEventListener("dragleave", function () { cell.classList.remove("wjp-cal-drop-target"); });
      cell.addEventListener("drop", function (e) {
        if (!state.dragging) return;
        e.preventDefault();
        cell.classList.remove("wjp-cal-drop-target");
        var newDate = cell.dataset.calDay;
        var origDate = state.dragging.origDate;
        var name = state.dragging.name;
        var ovKey = origDate + "|" + name;
        var overrides = loadOverrides();
        if (newDate === origDate) delete overrides[ovKey];
        else overrides[ovKey] = newDate;
        saveOverrides(overrides);
        state.dragging = null;
        rerender(findHost());
      });
    });
  }

  function attachClickHandlers(host) {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    Array.from(root.querySelectorAll("[data-cal-filter]")).forEach(function (b) {
      b.addEventListener("click", function () {
        state.filter = b.dataset.calFilter;
        try { localStorage.setItem(LS_FILTER, state.filter); } catch (_) {}
        rerender(host);
      });
    });
    Array.from(root.querySelectorAll("[data-cal-view]")).forEach(function (b) {
      b.addEventListener("click", function () {
        state.view = b.dataset.calView;
        try { localStorage.setItem(LS_VIEW, state.view); } catch (_) {}
        rerender(host);
      });
    });
    var hm = root.querySelector("[data-cal-heatmap]");
    if (hm) hm.addEventListener("click", function () {
      state.heatmap = !state.heatmap;
      try { localStorage.setItem(LS_HEATMAP, state.heatmap ? "1" : "0"); } catch (_) {}
      rerender(host);
    });
    var ex = root.querySelector("[data-cal-export]");
    if (ex) ex.addEventListener("click", function () {
      var events = harvestEvents();
      downloadICS(events);
    });
    var bal = root.querySelector("[data-cal-balance]");
    if (bal) bal.addEventListener("click", function () {
      var current = loadStartBalance();
      var v = prompt("Your current checking balance (used for the running-balance forecast). Leave empty to clear.", current != null ? current : "");
      if (v === null) return;
      if (v.trim() === "") { try { localStorage.removeItem(LS_BALANCE); } catch (_) {} }
      else {
        var n = parseFloat(v.replace(/[$,]/g, ""));
        if (isFinite(n)) saveStartBalance(n);
      }
      rerender(host);
    });
    var sd = root.querySelector("[data-cal-sug-dismiss]");
    if (sd) sd.addEventListener("click", function () {
      var b = sd.parentElement;
      if (b) b.style.display = "none";
    });
    var prev = root.querySelector("[data-cal-prev]");
    if (prev) prev.addEventListener("click", function () {
      var step = state.view === "quarter" ? 3 : 1;
      state.viewMonth -= step; while (state.viewMonth < 0) { state.viewMonth += 12; state.viewYear--; }
      rerender(host);
    });
    var next = root.querySelector("[data-cal-next]");
    if (next) next.addEventListener("click", function () {
      var step = state.view === "quarter" ? 3 : 1;
      state.viewMonth += step; while (state.viewMonth > 11) { state.viewMonth -= 12; state.viewYear++; }
      rerender(host);
    });
    Array.from(root.querySelectorAll("[data-cal-day]")).forEach(function (cell) {
      cell.addEventListener("click", function (e) {
        if (state.dragging) return;
        if (e.target && (e.target.closest && e.target.closest(".wjp-cal-chip[draggable]"))) {
          // Click on a chip — still open the day panel
        }
        state.selectedDate = cell.dataset.calDay;
        rerender(host);
        setTimeout(function () {
          var p = document.getElementById("wjp-cal-day-panel");
          if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      });
    });
    var close = root.querySelector("[data-cal-close]");
    if (close) close.addEventListener("click", function () { state.selectedDate = null; rerender(host); });
    var save = root.querySelector("[data-cal-save]");
    if (save) save.addEventListener("click", function () {
      var ta = root.querySelector("[data-cal-note]");
      var rm = root.querySelector("[data-cal-reminder]");
      var reminderAt = null;
      if (rm && rm.value) { var t = new Date(rm.value).getTime(); if (isFinite(t)) reminderAt = t; }
      setNote(state.selectedDate, ta ? ta.value : "", reminderAt);
      if (reminderAt && "Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch (_) {}
      }
      rerender(host);
    });
    var del = root.querySelector("[data-cal-delete]");
    if (del) del.addEventListener("click", function () { setNote(state.selectedDate, "", null); rerender(host); });
  }

  function rerender(host) {
    if (!host) return;
    var events = harvestEvents();
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.style.cssText = "width:100%;";
      host.appendChild(root);
    }
    root.innerHTML = buildHTML(events);
    attachClickHandlers(host);
    attachDragHandlers(root);
  }

  function tick() {
    try {
      checkReminders();
      ensureStyle();
      var host = findHost();
      if (!host) return;
      hideOriginalContent(host);
      rerender(host);
    } catch (e) {
      try { console.warn("[wjp-cal-redesign v3] tick threw", e); } catch (_) {}
    }
  }

  function boot() {
    setTimeout(tick, 800);
    setInterval(tick, 2500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.WJP_CalRedesign = {
    refresh: tick,
    _state: state,
    _harvest: harvestEvents,
    _resetNotes:     function () { try { localStorage.removeItem(LS_NOTES); } catch (_) {} },
    _resetOverrides: function () { try { localStorage.removeItem(LS_OVERRIDES); } catch (_) {} },
    _setBalance:     saveStartBalance
  };
})();
