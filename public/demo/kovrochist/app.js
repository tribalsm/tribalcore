(function () {
  // Тарифы — из открытого прайса. rate: null — цены на сайте нет, from: true — цена «от».
  var MATERIALS = [
    { id: 'syn_s', name: 'Синтетика, ворс до 2 см', rate: 250 },
    { id: 'syn_l', name: 'Синтетика, ворс более 2 см', rate: 300 },
    { id: 'wool',  name: 'Шерсть', rate: 280 },
    { id: 'visc',  name: 'Вискоза', rate: 500 },
    { id: 'silk',  name: 'Шёлк', rate: 1500, from: true },
    { id: 'cot',   name: 'Хлопок', rate: null }
  ];
  var MIN_ITEM = 450, DELIVERY_CITY = 700;
  var OPTS = [
    { id: 'cond',  name: 'Кондиционирование', hint: 'мягкость и лёгкий запах, 30 ₽/м²', perM2: 30 },
    { id: 'comb',  name: 'Вычёсывание шерсти животных', hint: '50 ₽/м²', perM2: 50 },
    { id: 'dirty', name: 'Сильное загрязнение', hint: '+30% к стирке', pct: 30 },
    { id: 'smell', name: 'Стойкие запахи', hint: '+50% к стирке', pct: 50 },
    { id: 'stain', name: 'Пластилин, краска, клей, жвачка, маркер', hint: '+10–100% к стирке, оценим на месте', range: [10, 100] }
  ];

  var items = [];
  var uid = 0;
  var $ = function (id) { return document.getElementById(id); };
  var rub = function (n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽'; };
  var num = function (v) { var x = parseFloat(String(v).replace(',', '.')); return isFinite(x) && x > 0 ? x : 0; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function newItem() {
    items.push({ id: ++uid, mat: 'syn_s', shape: 'rect', a: '', b: '', d: '', opts: {} });
    render();
  }

  function area(it) {
    if (it.shape === 'round') { var r = num(it.d) / 2; return Math.PI * r * r; }
    return num(it.a) * num(it.b);
  }

  // Считает один ковёр. Возвращает {min, max, unknown, area}
  function calc(it) {
    var m = MATERIALS.filter(function (x) { return x.id === it.mat; })[0];
    var s = Math.round(area(it) * 100) / 100;
    if (!s) return { area: 0, min: 0, max: 0, empty: true };
    if (m.rate === null) return { area: s, unknown: true, min: 0, max: 0 };
    var wash = s * m.rate;
    var pct = 0, perM2 = 0, extraMax = 0;
    OPTS.forEach(function (o) {
      if (!it.opts[o.id]) return;
      if (o.pct) pct += o.pct;
      if (o.perM2) perM2 += o.perM2;
      if (o.range) { pct += o.range[0]; extraMax += o.range[1] - o.range[0]; }
    });
    var lo = wash * (1 + pct / 100) + s * perM2;
    var hi = lo + wash * extraMax / 100;
    return { area: s, min: Math.max(MIN_ITEM, lo), max: Math.max(MIN_ITEM, hi), approx: !!m.from || extraMax > 0, mat: m };
  }

  function itemLabel(it, r) {
    var m = MATERIALS.filter(function (x) { return x.id === it.mat; })[0];
    var f = function (v) { return num(v).toLocaleString('ru-RU'); };
    var size = it.shape === 'round' ? 'круглый Ø ' + f(it.d) + ' м' : f(it.a) + '×' + f(it.b) + ' м';
    var extra = OPTS.filter(function (o) { return it.opts[o.id]; }).map(function (o) { return o.name.toLowerCase(); });
    return m.name + ', ' + size + ' (' + r.area.toLocaleString('ru-RU') + ' м²)' + (extra.length ? ' + ' + extra.join(', ') : '');
  }

  function priceText(r) {
    if (r.unknown) return 'цену уточним';
    var t = Math.round(r.max) > Math.round(r.min) ? rub(r.min) + ' – ' + rub(r.max) : rub(r.min);
    return (r.approx && !(Math.round(r.max) > Math.round(r.min)) ? 'от ' : '') + t;
  }

  function render() {
    var box = $('kc-items');
    box.innerHTML = items.map(function (it, i) {
      return '<div class="kc-card" data-id="' + it.id + '">' +
        '<div class="kc-item-head"><h2>Ковёр ' + (i + 1) + '</h2>' +
        (items.length > 1 ? '<button type="button" class="kc-remove" data-act="rm">Убрать</button>' : '') + '</div>' +
        '<div class="kc-row kc-one"><div><label class="kc-l" for="m' + it.id + '">Материал</label><select id="m' + it.id + '" data-f="mat">' +
          MATERIALS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === it.mat ? ' selected' : '') + '>' + m.name + '</option>'; }).join('') +
        '</select></div></div>' +
        '<div class="kc-seg" role="group" aria-label="Форма ковра">' +
          '<button type="button" data-act="rect" aria-pressed="' + (it.shape === 'rect') + '">Прямоугольный</button>' +
          '<button type="button" data-act="round" aria-pressed="' + (it.shape === 'round') + '">Круглый</button></div>' +
        (it.shape === 'rect'
          ? '<div class="kc-row"><div><label class="kc-l" for="a' + it.id + '">Длина, м</label><input id="a' + it.id + '" type="text" inputmode="decimal" placeholder="3" data-f="a" value="' + esc(it.a) + '"></div>' +
            '<div><label class="kc-l" for="b' + it.id + '">Ширина, м</label><input id="b' + it.id + '" type="text" inputmode="decimal" placeholder="2" data-f="b" value="' + esc(it.b) + '"></div></div>'
          : '<div class="kc-row kc-one"><div><label class="kc-l" for="d' + it.id + '">Диаметр, м</label><input id="d' + it.id + '" type="text" inputmode="decimal" placeholder="2" data-f="d" value="' + esc(it.d) + '"></div></div>') +
        '<div class="kc-opts">' + OPTS.map(function (o) {
          return '<label class="kc-opt"><input type="checkbox" data-o="' + o.id + '"' + (it.opts[o.id] ? ' checked' : '') + '><span>' + o.name + '<small>' + o.hint + '</small></span></label>';
        }).join('') + '</div>' +
        '<div class="kc-item-sum" id="s' + it.id + '"></div>' +
      '</div>';
    }).join('');
    update();
  }

  function update() {
    var lo = 0, hi = 0, approx = false, unknown = false, filled = 0, lines = [];
    items.forEach(function (it, i) {
      var r = calc(it);
      var el = $('s' + it.id);
      if (r.empty) { el.innerHTML = 'Укажите размер, чтобы увидеть цену'; return; }
      filled++;
      var m = MATERIALS.filter(function (x) { return x.id === it.mat; })[0];
      el.innerHTML = r.area.toLocaleString('ru-RU') + ' м²' + (m.rate ? ' × ' + (m.from ? 'от ' : '') + m.rate + ' ₽/м²' : '') + ' · <b>' + priceText(r) + '</b>' +
        (!r.unknown && r.min === MIN_ITEM ? ' <small>(минимальная стоимость за изделие)</small>' : '');
      if (r.unknown) unknown = true; else { lo += r.min; hi += r.max; if (r.approx) approx = true; }
      lines.push('Ковёр ' + (i + 1) + ': ' + priceText(r));
    });
    var far = $('kc-delivery').value === 'far';
    if (filled) {
      if (!far) { lo += DELIVERY_CITY; hi += DELIVERY_CITY; lines.push('Доставка по Томску: ' + rub(DELIVERY_CITY)); }
      else lines.push('Доставка: по договорённости');
    }
    var range = Math.round(hi) > Math.round(lo);
    $('kc-total').textContent = !filled ? '—' : (lo ? ((approx && !range) || far || unknown ? 'от ' : '') + rub(lo) + (range ? ' – ' + rub(hi) : '') : 'уточним по телефону');
    $('kc-breakdown').innerHTML = lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
    var notes = [];
    var hasSilk = items.some(function (it) { return it.mat === 'silk' && !calc(it).empty; });
    var hasStain = items.some(function (it) { return it.opts.stain && !calc(it).empty; });
    if (hasSilk || hasStain) notes.push('Точную цену ' + (hasSilk && hasStain ? 'за шёлк и сложные пятна' : hasSilk ? 'за шёлк' : 'за сложные пятна') + ' назовём после осмотра.');
    if (unknown) notes.push('Цену хлопкового ковра уточним по телефону.');
    if (far) notes.push('Стоимость доставки за город согласуем по телефону.');
    $('kc-note').textContent = notes.join(' ');
    $('kc-submit').disabled = !filled;
    return { lo: lo, hi: hi, range: range, far: far, approx: approx, unknown: unknown, filled: filled };
  }

  var itemsBox = $('kc-items');
  itemsBox.addEventListener('input', function (e) {
    var card = e.target.closest('[data-id]'); if (!card) return;
    var it = items.filter(function (x) { return x.id == card.dataset.id; })[0];
    if (e.target.dataset.f) it[e.target.dataset.f] = e.target.value;
    if (e.target.dataset.o) it.opts[e.target.dataset.o] = e.target.checked;
    update();
  });
  itemsBox.addEventListener('change', function (e) { if (e.target.tagName === 'SELECT') update(); });
  itemsBox.addEventListener('click', function (e) {
    var act = e.target.dataset.act; if (!act) return;
    var card = e.target.closest('[data-id]');
    var it = items.filter(function (x) { return x.id == card.dataset.id; })[0];
    if (act === 'rm') items = items.filter(function (x) { return x !== it; });
    else it.shape = act;
    render();
  });
  $('kc-add').addEventListener('click', newItem);
  $('kc-delivery').addEventListener('change', update);

  $('kc-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('kc-name').value.trim(), phone = $('kc-phone').value.trim();
    var digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { $('kc-err').textContent = 'Укажите телефон, чтобы мы могли перезвонить.'; $('kc-phone').focus(); return; }
    $('kc-err').textContent = '';
    var t = update();
    var msg = '🧺 Новая заявка с сайта\n\n' +
      'Имя: ' + (name || '—') + '\nТелефон: ' + phone + '\n' +
      'Адрес: ' + ($('kc-addr').value.trim() || '—') + '\nКогда забрать: ' + ($('kc-time').value.trim() || '—') + '\n\nКовры:\n';
    items.forEach(function (it, i) { var r = calc(it); if (!r.empty) msg += (i + 1) + '. ' + itemLabel(it, r) + ' — ' + priceText(r) + '\n'; });
    msg += '\nДоставка: ' + (t.far ? 'за город, по договорённости' : 'Томск, ' + rub(DELIVERY_CITY)) + '\n';
    msg += 'Итого по калькулятору: ' + $('kc-total').textContent;
    $('kc-tg').textContent = msg;
    $('kc-sent').classList.add('kc-show');
    $('kc-sent').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  newItem();
})();
