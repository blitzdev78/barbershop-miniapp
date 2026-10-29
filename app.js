/* Mini App записи в барбершоп «Лезвие».
 *
 * Расписание приходит от бота в адресе страницы (?d=...): услуги и свободные окна на 7 дней.
 * Выбор клиента уходит обратно боту через Telegram.WebApp.sendData — бот ещё раз проверяет,
 * что время свободно, и создаёт запись. Открыть страницу можно и в обычном браузере:
 * тогда показываются демо-данные, а вместо кнопки Telegram — своя кнопка внизу.
 */
(function () {
  "use strict";

  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.platform && tg.platform !== "unknown");
  var nativeButtons = inTelegram && tg.isVersionAtLeast("6.1");

  var WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  var MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var MONTHS_FULL = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
    "сентября", "октября", "ноября", "декабря"];

  // ---------- данные ----------

  function decodePayload() {
    var raw = new URLSearchParams(location.search).get("d");
    if (!raw) return null;
    try {
      var b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var data = JSON.parse(new TextDecoder().decode(bytes));
      return data && data.v === 1 ? data : null;
    } catch (e) {
      return null;
    }
  }

  // Демо-расписание для открытия в браузере (портфолио): та же структура, что присылает бот
  function demoPayload() {
    var services = [
      ["haircut", "Мужская стрижка", 1200, 60], ["beard", "Оформление бороды", 800, 30],
      ["combo", "Стрижка + борода", 1800, 90], ["kids", "Детская стрижка", 900, 45],
      ["buzz", "Стрижка машинкой", 700, 30]
    ];
    var times = [];
    for (var h = 10; h < 20; h++) times.push((h < 10 ? "0" : "") + h + ":00");
    var z = 180, today = bizNow(z), free = {};
    for (var i = 0; i < 7; i++) {
      var day = addDays(today.date, i);
      var busy = [];
      for (var k = 0; k < times.length; k++) if ((i * 7 + k * 3) % 5 === 0) busy.push([k * 60, k * 60 + 60]);
      free[day] = services.map(function (s) {
        var mask = 0;
        for (var k = 0; k < times.length; k++) {
          var start = k * 60, end = start + s[3];
          if (end > times.length * 60) continue;
          var clash = busy.some(function (b) { return start < b[1] && b[0] < end; });
          if (!clash) mask |= 1 << k;
        }
        return mask;
      });
    }
    return { v: 1, z: z, l: 30, t: times, s: services, f: free, demo: true };
  }

  // «Сейчас» в часовом поясе заведения, независимо от часового пояса телефона
  function bizNow(offsetMin) {
    var d = new Date(Date.now() + offsetMin * 60000);
    return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function toMinutes(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
  function parseDay(iso) { return new Date(iso + "T00:00:00Z"); }
  function dayLong(iso) { var d = parseDay(iso); return d.getUTCDate() + " " + MONTHS_FULL[d.getUTCMonth()]; }

  var data = decodePayload() || demoPayload();
  var services = data.s.map(function (s) { return { id: s[0], name: s[1], price: s[2], duration: s[3] }; });

  function freeTimes(day, serviceIndex) {
    var mask = (data.f[day] || [])[serviceIndex] || 0;
    var now = bizNow(data.z);
    if (day < now.date) return [];
    return data.t.filter(function (t, k) {
      if (!(mask & (1 << k))) return false;
      return day > now.date || toMinutes(t) >= now.minutes + data.l;
    });
  }

  // ---------- состояние и элементы ----------

  var state = { step: 1, service: -1, day: null, time: null };
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function haptic() { if (nativeButtons && tg.HapticFeedback) tg.HapticFeedback.selectionChanged(); }
  function rub(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽"; }

  // ---------- шаг 1: услуги ----------

  function renderServices() {
    var box = $("services");
    box.innerHTML = "";
    services.forEach(function (s, i) {
      var b = el("button", "service");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(state.service === i));
      b.appendChild(el("span", "radio"));
      var info = el("span", "info");
      info.appendChild(el("b", null, s.name));
      info.appendChild(el("small", null, s.duration + " мин"));
      b.appendChild(info);
      b.appendChild(el("span", "price", rub(s.price)));
      b.addEventListener("click", function () {
        if (state.service !== i) { state.service = i; state.time = null; haptic(); }
        renderServices();
        updateButtons();
      });
      box.appendChild(b);
    });
  }

  // ---------- шаг 2: день и время ----------

  function availableDays() {
    var today = bizNow(data.z).date;
    return Object.keys(data.f).sort().filter(function (d) { return d >= today; });
  }

  function renderDays() {
    var box = $("days");
    box.innerHTML = "";
    var days = availableDays();
    var today = bizNow(data.z).date;
    if (!state.day || !freeTimes(state.day, state.service).length) {
      state.day = days.filter(function (d) { return freeTimes(d, state.service).length; })[0] || null;
    }
    days.forEach(function (d) {
      var date = parseDay(d);
      var b = el("button", "day");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(d === state.day));
      b.disabled = !freeTimes(d, state.service).length;
      b.appendChild(el("span", "wd", d === today ? "Сегодня" : d === addDays(today, 1) ? "Завтра" : WEEKDAYS[date.getUTCDay()]));
      b.appendChild(el("span", "num", String(date.getUTCDate())));
      b.appendChild(el("span", "mon", MONTHS[date.getUTCMonth()]));
      b.addEventListener("click", function () {
        if (state.day !== d) { state.day = d; state.time = null; haptic(); }
        renderDays();
        renderTimes();
        updateButtons();
      });
      box.appendChild(b);
    });
  }

  function renderTimes() {
    var box = $("times");
    box.innerHTML = "";
    var free = state.day ? freeTimes(state.day, state.service) : [];
    $("no-times").hidden = free.length > 0;
    if (!free.length) return;
    data.t.forEach(function (t) {
      var b = el("button", "time", t);
      b.type = "button";
      b.disabled = free.indexOf(t) < 0;
      b.setAttribute("aria-pressed", String(t === state.time));
      b.addEventListener("click", function () {
        state.time = t;
        haptic();
        renderTimes();
        updateButtons();
      });
      box.appendChild(b);
    });
  }

  // ---------- шаг 3: контакты ----------

  function digitsOf(v) { return (v || "").replace(/\D/g, ""); }

  // Та же логика, что в боте (utils.normalize_phone): 8XXXXXXXXXX → +7XXXXXXXXXX, 10–15 цифр
  function normalizePhone(v) {
    var d = digitsOf(v);
    if (d.length === 11 && d[0] === "8") d = "7" + d.slice(1);
    if (d.length === 10 && d[0] === "9") d = "7" + d;
    return d.length >= 10 && d.length <= 15 ? "+" + d : null;
  }

  function formatPhoneInput() {
    var input = $("phone");
    var d = digitsOf(input.value);
    if (d[0] === "8") d = "7" + d.slice(1);
    if (d[0] === "9") d = "7" + d;
    if (d[0] !== "7") { input.value = d ? "+" + d : ""; return; }
    var p = "+7";
    if (d.length > 1) p += " " + d.slice(1, 4);
    if (d.length > 4) p += " " + d.slice(4, 7);
    if (d.length > 7) p += "-" + d.slice(7, 9);
    if (d.length > 9) p += "-" + d.slice(9, 11);
    input.value = p;
  }

  function prettyPhone(p) {
    var m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(p || "");
    return m ? "+7 " + m[1] + " " + m[2] + "-" + m[3] + "-" + m[4] : p;
  }

  function validateContacts() {
    var name = $("name").value.trim();
    var phone = normalizePhone($("phone").value);
    var error = "";
    $("name").classList.toggle("bad", name.length < 2);
    $("phone").classList.toggle("bad", !phone);
    if (name.length < 2) error = "Напишите имя — хотя бы 2 буквы.";
    else if (!phone) error = "Проверьте номер телефона, например +7 900 123-45-67.";
    else if (!$("consent").checked) error = "Отметьте согласие на обработку данных.";
    $("form-error").textContent = error;
    $("form-error").hidden = !error;
    return error ? null : { name: name, phone: phone };
  }

  // ---------- шаг 4: итог ----------

  function renderSummary(target) {
    var s = services[state.service];
    var rows = [
      ["Услуга", s.name], ["Когда", dayLong(state.day) + ", " + state.time],
      ["Длительность", s.duration + " мин"], ["Имя", $("name").value.trim()],
      ["Телефон", prettyPhone(normalizePhone($("phone").value))], ["Стоимость", rub(s.price)]
    ];
    var box = $(target);
    box.innerHTML = "";
    rows.forEach(function (r, i) {
      var row = el("div", "row" + (i === rows.length - 1 ? " total" : ""));
      row.appendChild(el("span", null, r[0]));
      row.appendChild(el("b", null, r[1]));
      box.appendChild(row);
    });
  }

  // ---------- навигация и кнопки ----------

  var LABELS = { 1: "Выбрать время", 2: "Далее", 3: "Проверить запись", 4: "Записаться" };

  function canContinue() {
    if (state.step === 1) return state.service >= 0;
    if (state.step === 2) return !!(state.day && state.time);
    return true;
  }

  function go(step) {
    state.step = step;
    [1, 2, 3, 4].forEach(function (n) { $("screen-" + n).hidden = n !== step; });
    $("screen-done").hidden = true;
    document.querySelectorAll(".progress li").forEach(function (li) {
      li.classList.toggle("on", +li.dataset.step <= step);
    });
    var s = services[state.service];
    if (step === 2) {
      $("crumb-2").textContent = s.name + " · " + rub(s.price);
      renderDays();
      renderTimes();
    }
    if (step === 3) $("crumb-3").textContent = s.name + " · " + dayLong(state.day) + ", " + state.time;
    if (step === 4) renderSummary("summary");
    window.scrollTo(0, 0);
    updateButtons();
  }

  function updateButtons() {
    var ok = canContinue();
    if (nativeButtons) {
      tg.MainButton.setParams({
        text: LABELS[state.step], is_visible: true, is_active: ok,
        color: ok ? "#E9C27A" : "#4A4538", text_color: ok ? "#1B1A17" : "#8F8676"
      });
      if (state.step > 1) tg.BackButton.show(); else tg.BackButton.hide();
    } else {
      $("bottom").hidden = false;
      $("web-main").textContent = LABELS[state.step];
      $("web-main").disabled = !ok;
      $("web-back").hidden = state.step === 1;
    }
  }

  function onMain() {
    if (!canContinue()) return;
    if (state.step === 3 && !validateContacts()) {
      if (nativeButtons && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred("error");
      return;
    }
    if (state.step < 4) { go(state.step + 1); return; }
    submit();
  }

  function onBack() { if (state.step > 1) go(state.step - 1); }

  function submit() {
    var c = validateContacts();
    var s = services[state.service];
    var payload = { v: 1, s: s.id, d: state.day, t: state.time, n: c.name, p: c.phone };
    if (inTelegram && !data.demo) {
      // Окно закроется, бот получит данные сообщением и подтвердит запись в чате
      if (nativeButtons) tg.MainButton.showProgress();
      tg.sendData(JSON.stringify(payload));
      return;
    }
    renderSummary("summary-done");
    [1, 2, 3, 4].forEach(function (n) { $("screen-" + n).hidden = true; });
    $("screen-done").hidden = false;
    $("bottom").hidden = true;
    if (nativeButtons) { tg.MainButton.hide(); tg.BackButton.hide(); }
    document.querySelectorAll(".progress li").forEach(function (li) { li.classList.add("on"); });
  }

  // ---------- запуск ----------

  if (inTelegram) {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast("6.1")) { tg.setHeaderColor("#1B1A17"); tg.setBackgroundColor("#1B1A17"); }
    var user = tg.initDataUnsafe && tg.initDataUnsafe.user;
    if (user && user.first_name) {
      $("hello").textContent = "Здравствуйте, " + user.first_name + "!";
      $("name").value = user.first_name;
    }
  }
  if (nativeButtons) {
    tg.MainButton.onClick(onMain);
    tg.BackButton.onClick(onBack);
  }
  $("web-main").addEventListener("click", onMain);
  $("web-back").addEventListener("click", onBack);
  $("phone").addEventListener("input", formatPhoneInput);
  ["name", "phone", "consent"].forEach(function (id) {
    $(id).addEventListener("input", function () { $("form-error").hidden = true; this.classList.remove("bad"); });
  });

  renderServices();
  go(1);
})();
