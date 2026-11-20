(function () {
  // Цены и залоги — из открытого каталога prokat-70.ru (сутки / залог). В демо — часть позиций.
  var CATALOG = [
    { name: 'Инструмент по бетону', tools: [
      ['Перфоратор Bosch GBH 8-45 (SDS-max)', 800, 3000],
      ['Перфоратор Bosch / Makita', 400, 2000],
      ['Отбойный молоток Makita 1202', 1000, 3000],
      ['Отбойный молоток P.I.T. GSH25-C1', 800, 2000],
      ['Бетонолом', 1200, 2500],
      ['Бетономешалка 180 л', 500, 1500],
      ['Бетономешалка 120 л', 400, 1500],
      ['Штроборез', 500, 1500],
      ['Штроборез с пылесосом', 900, 1500]
    ]},
    { name: 'Строительное оборудование', tools: [
      ['Виброплита 140 кг', 1500, 4000],
      ['Виброплита бензиновая 60 кг', 1000, 4000],
      ['Бензорез', 1500, 5000],
      ['Компрессор', 600, 3000],
      ['Сварочный инвертор', 400, 1500],
      ['Пылесос моющий Philips Triathlon', 600, 1500],
      ['Тепловая пушка дизельная', 500, 2000]
    ]},
    { name: 'Инструмент по дереву', tools: [
      ['Циклёвочная машина СО 206', 1500, 5000],
      ['Пила циркулярная Metabo', 500, 2000],
      ['Пила торцовочная', 400, 1500],
      ['Электрорубанок (ножи оплачиваются отдельно)', 600, 1500],
      ['Бензопила', 700, 2000],
      ['Лобзик', 300, 1000]
    ]},
    { name: 'Сад-огород', tools: [
      ['Мотоблок «Нева 2М»', 1400, 5000],
      ['Газонокосилка Patriot PT 52LS', 900, 4000],
      ['Триммер бензиновый', 500, 1500],
      ['Триммер электрический', 300, 1000],
      ['Бензобур', 800, 2500],
      ['Мотопомпа', 800, 3000]
    ]}
  ];
  var POINTS = { alt: 'ул. Алтайская, 173/1', ver: 'проезд Вершинина, 8', sol: 'пер. Соляной, 11А' };
  var DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  var $ = function (id) { return document.getElementById(id); };
  var rub = function (n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽'; };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var human = function (d) { return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' (' + DAYS[d.getDay()] + ')'; };

  // Разделы и инструменты
  $('pb-cat').innerHTML = CATALOG.map(function (c, i) { return '<option value="' + i + '">' + c.name + '</option>'; }).join('');
  function fillTools() {
    var c = CATALOG[$('pb-cat').value];
    $('pb-tool').innerHTML = c.tools.map(function (t, i) { return '<option value="' + i + '">' + t[0] + '</option>'; }).join('');
  }
  function tool() { return CATALOG[$('pb-cat').value].tools[$('pb-tool').value]; }

  // Дата: с сегодняшнего дня, по умолчанию — завтра (не воскресенье)
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var def = new Date(today); def.setDate(def.getDate() + 1); if (def.getDay() === 0) def.setDate(def.getDate() + 1);
  $('pb-date').min = iso(today); $('pb-date').value = iso(def);

  function picked() { var v = $('pb-date').value; if (!v) return null; var p = v.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function tariff() { return document.querySelector('input[name=pb-t]:checked').value; }

  function fillTimes() {
    var d = picked(), t = tariff(), prev = $('pb-time').value, opts = [];
    if (d && d.getDay() !== 0) {
      var last = d.getDay() === 6 ? 16 : 18;
      for (var h = 9; h <= last; h++) opts.push(pad(h) + ':00');
      if (t === 'night') opts = ['18:00'];
    }
    $('pb-time').innerHTML = opts.map(function (o) { return '<option' + (o === prev ? ' selected' : '') + '>' + o + '</option>'; }).join('');
  }

  function update() {
    var d = picked(), t = tariff(), tl = tool();
    var sat = d && d.getDay() === 6, sun = d && d.getDay() === 0;
    var nightEl = $('pb-t-night'), nightInput = nightEl.querySelector('input');
    nightInput.disabled = !!sat; nightEl.classList.toggle('pb-off', !!sat);
    if (sat && t === 'night') { document.querySelector('input[value=day]').checked = true; t = 'day'; }
    fillTimes();
    $('pb-days-row').style.display = t === 'day' ? '' : 'none';

    var err = '';
    if (!d) err = 'Выберите дату.';
    else if (d < today) err = 'Дата уже прошла.';
    else if (sun) err = 'В воскресенье выдачи нет — выберите другой день.';
    $('pb-date-err').textContent = err;

    $('pb-tool-info').innerHTML = '<b>' + rub(tl[1]) + '</b> за сутки · залог ' + rub(tl[2]);

    if (err) { $('pb-sum').textContent = '—'; $('pb-lines').innerHTML = ''; $('pb-note').textContent = ''; return null; }

    var days = Math.min(30, Math.max(1, parseInt($('pb-days').value, 10) || 1));
    var rent, period, start = $('pb-time').value, ret;
    var h = parseInt(start, 10);
    if (t === 'day') {
      rent = tl[1] * days; period = days + ' сут.';
      var r = new Date(d); r.setDate(r.getDate() + days); ret = human(r) + ', ' + start;
      var retSun = r.getDay() === 0;
    } else if (t === 'night') {
      rent = tl[1] * 0.5; period = 'ночной тариф';
      var n = new Date(d); n.setDate(n.getDate() + 1); ret = human(n) + ', 10:00';
    } else {
      rent = tl[1] * 0.5; period = '3 часа';
      ret = human(d) + ', ' + pad(h + 3) + ':00';
    }
    $('pb-sum').textContent = rub(rent + tl[2]);
    $('pb-lines').innerHTML = '<li>Аренда (' + period + '): ' + rub(rent) + '</li><li>Залог: ' + rub(tl[2]) + ' — вернём при возврате</li>' +
      '<li>Получение: ' + human(d) + ', ' + start + '</li><li>Вернуть до: ' + ret + '</li>';
    var notes = [];
    if (d.getTime() === today.getTime()) notes.push('Бронь на сегодня возможна, но наличие не гарантируем — уточним по телефону.');
    if (t === 'day' && retSun) notes.push('Возврат выпадает на воскресенье, когда пункт закрыт, — договоримся по телефону.');
    if (t === 'h3' && h + 3 > (d.getDay() === 6 ? 17 : 19)) notes.push('3 часа заканчиваются после закрытия пункта — выберите время пораньше.');
    $('pb-note').textContent = notes.join(' ');
    return { d: d, start: start, period: period, rent: rent, ret: ret };
  }

  $('pb-cat').addEventListener('change', function () { fillTools(); update(); });
  ['pb-tool', 'pb-point', 'pb-date', 'pb-time', 'pb-days'].forEach(function (id) {
    $(id).addEventListener('input', update); $(id).addEventListener('change', update);
  });
  $('pb-tariffs').addEventListener('change', update);

  $('pb-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = update();
    if (!r) { $('pb-err').textContent = 'Проверьте дату получения.'; return; }
    var phone = $('pb-phone').value.trim();
    if (phone.replace(/\D/g, '').length < 10) { $('pb-err').textContent = 'Укажите телефон, чтобы мы подтвердили бронь.'; $('pb-phone').focus(); return; }
    $('pb-err').textContent = '';
    var tl = tool();
    var msg = '🔧 Заявка на бронь с сайта\n\n' +
      'Инструмент: ' + tl[0] + '\n' +
      'Пункт: ' + POINTS[$('pb-point').value] + '\n' +
      'Получение: ' + human(r.d) + ', ' + r.start + '\n' +
      'Тариф: ' + r.period + ', вернуть до ' + r.ret + '\n' +
      'Аренда: ' + rub(r.rent) + ' + залог ' + rub(tl[2]) + '\n\n' +
      'Имя: ' + ($('pb-name').value.trim() || '—') + '\nТелефон: ' + phone + '\n' +
      'Комментарий: ' + ($('pb-comment').value.trim() || '—') + '\n\n' +
      '👉 Проверьте наличие и перезвоните клиенту';
    $('pb-msg').textContent = msg;
    $('pb-sent').classList.add('pb-show');
    $('pb-sent').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  fillTools();
  update();
})();
