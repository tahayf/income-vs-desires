/**
 * IncomeVsDesires — ortak para/süre kütüphanesi.
 *
 * Klasik script olarak yüklenir (content script, popup ve service worker
 * aynı dosyayı paylaşabilsin diye). Her şeyi `globalThis.IVD` altına koyar.
 */
(function (root) {
  'use strict';

  /** Desteklenen para birimleri. `patterns` regex parçası olarak kullanılır. */
  const CURRENCIES = {
    TRY: { code: 'TRY', label: 'Türk Lirası', symbol: '₺', locale: 'tr-TR' },
    USD: { code: 'USD', label: 'Amerikan Doları', symbol: '$', locale: 'en-US' },
    EUR: { code: 'EUR', label: 'Euro', symbol: '€', locale: 'de-DE' },
    GBP: { code: 'GBP', label: 'İngiliz Sterlini', symbol: '£', locale: 'en-GB' },
  };

  /** Sayfada gördüğümüz işareti para birimi koduna çeviren tablo. */
  const TOKEN_TO_CODE = {
    '₺': 'TRY', TL: 'TRY', TRY: 'TRY', 'TL.': 'TRY',
    $: 'USD', USD: 'USD', US$: 'USD',
    '€': 'EUR', EUR: 'EUR',
    '£': 'GBP', GBP: 'GBP',
  };

  // Harf tabanlı kodlarda sınır şart, yoksa "OUTLET" içindeki "TL"yi fiyat
  // sanarız. Ama sınırı `\b` ile değil, **harf** ile tanımlıyoruz:
  //
  //   "811,41TL"              rakam ile T arasında \b yok, kaçırırdık
  //   "11.999,96 TL29.999,90" TL'den sonra rakam var, \b yine yok
  //
  // İkincisi gerçek sitelerde sık: indirimli fiyatla üstü çizili fiyat satır
  // içi yan yana duruyor. `\b` kullanınca ilk fiyat kaçıyor ve eşleşme ikinciye
  // kayıyordu; ekranda çıplak bir sayı kalıyordu. Rakam komşuluğu serbest,
  // harf komşuluğu yasak.
  const LETTER = 'A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû';
  const CODE = '(?:TL|TRY|USD|EUR|GBP)';
  const SYMBOL_BEFORE = `(?:₺|€|£|US\\$|\\$|(?<![${LETTER}])${CODE})`;
  const SYMBOL_AFTER = `(?:₺|€|£|US\\$|\\$|${CODE}(?![${LETTER}]))`;

  // 1.299,90 · 1,299.90 · 1 299,90 (kırılmaz boşlukla) · 500 · 19.99
  //
  // Binlik ayracı olarak **normal boşluk kabul edilmiyor**: "Beden 42 500 TL"
  // gibi metinlerde "42 500" tek sayı sanılıp fiyat 84 katına çıkıyordu. Bilerek
  // konan tipografik ayraçlar (kırılmaz / dar boşluk) kalıyor.
  const NUMBER_SRC =
    '(?:\\d{1,3}(?:[.,\\u00A0\\u202F]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';

  /**
   * Yeni bir eşleştirme regex'i üretir (lastIndex paylaşılmasın diye her seferinde yeni).
   *
   * Bilerek **büyük/küçük harfe duyarlı** (`i` bayrağı yok). Duyarsızken
   * İngilizce "try 3 times" metni `TRY 3` diye okunup chip'e dönüyordu; küçük
   * harfli "tl", "eur" da aynı şekilde. Siteler para kodunu büyük yazıyor.
   */
  function createPriceRegex() {
    return new RegExp(
      `(?:(${SYMBOL_BEFORE})\\s{0,2}(${NUMBER_SRC}))|(?:(${NUMBER_SRC})\\s{0,2}(${SYMBOL_AFTER}))`,
      'g'
    );
  }

  /** Regex eşleşmesinden { amount, currency, text } çıkarır; anlamsızsa null. */
  function readMatch(match) {
    // Bir sayının ortasından başlayan eşleşme fiyat değildir. Amazon fırsat
    // kartlarında ondalık ayırıcı hiç yazılmıyor ("3.499" + "00" + "TL");
    // regex "3.499"u alamayınca "49900TL"yi buluyor, fiyat 14 katına çıkıyordu.
    // Yanlış fiyat göstermektense hiç çevirmemek iyidir.
    if (match.input && match.index > 0) {
      const before = match.input.slice(Math.max(0, match.index - 2), match.index);
      if (/\d$|\d[.,]$/.test(before)) return null;
    }

    const symbolToken = match[1] || match[4];
    const numberToken = match[2] || match[3];
    if (!symbolToken || !numberToken) return null;

    const currency = TOKEN_TO_CODE[symbolToken.toUpperCase().replace(/\.$/, '')];
    if (!currency) return null;

    const amount = parseAmount(numberToken);
    if (amount === null || amount <= 0 || amount > 1e9) return null;

    return { amount, currency, text: match[0] };
  }

  /**
   * "1.299,90" / "1,299.90" / "1 299" gibi yazımları sayıya çevirir.
   * Kural: iki ayraç da varsa sondaki ondalıktır. Tek ayraç varsa ve
   * ardından tam 3 hane geliyorsa binlik ayracıdır.
   */
  function parseAmount(raw) {
    const cleaned = raw.replace(/[   ]/g, '');
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');

    let normalized;
    if (lastDot === -1 && lastComma === -1) {
      normalized = cleaned;
    } else if (lastDot !== -1 && lastComma !== -1) {
      const decimalSep = lastDot > lastComma ? '.' : ',';
      normalized = stripGrouping(cleaned, decimalSep);
    } else {
      const sep = lastDot !== -1 ? '.' : ',';
      const tail = cleaned.slice(cleaned.lastIndexOf(sep) + 1);
      const occurrences = cleaned.split(sep).length - 1;
      // "1.500" veya "1.234.567" → binlik. "19,99" → ondalık.
      normalized =
        tail.length === 3 && (occurrences > 1 || cleaned.split(sep)[0].length <= 3)
          ? cleaned.split(sep).join('')
          : stripGrouping(cleaned, sep);
    }

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function stripGrouping(text, decimalSep) {
    const idx = text.lastIndexOf(decimalSep);
    const intPart = text.slice(0, idx).replace(/[.,]/g, '');
    const fracPart = text.slice(idx + 1);
    return `${intPart}.${fracPart}`;
  }

  // --- Kur çevrimi -----------------------------------------------------------

  /**
   * `amount` birimini `from`dan `to`ya çevirir. rates EUR bazlı olmalı.
   *
   * Koda gömülü yedek kur tablosu **yok**. Eskiden vardı ve elle
   * güncellenmesi gerekiyordu; unutulunca (TRY 45 → 54) dövizli fiyatlar
   * %20 ucuz görünüyordu. Artık tek kaynak, background.js'in son başarılı
   * çekimde storage'a yazdığı tablo. Hiç çekim olmadıysa (kurulum anında
   * çevrimdışı) döviz çevrilmez, null döner; aynı birim her zaman çalışır.
   */
  function convert(amount, from, to, rates) {
    if (from === to) return amount;
    if (!rates || !rates.EUR) return null;
    const fromRate = rates[from];
    const toRate = rates[to];
    if (!fromRate || !toRate) return null;
    return (amount / fromRate) * toRate;
  }

  // --- Giderler --------------------------------------------------------------

  /**
   * Bir gideri `currency` biriminde aylık tutara indirger. Yıllıklar 12'ye
   * bölünür. Para birimi kaydı olmayan eski giderler maaşın biriminde sayılır.
   * Kur yoksa (döviz gider, hiç çekim yapılmamış) null.
   */
  function expenseMonthly(item, currency, rates) {
    const own = item.period === 'yearly' ? item.amount / 12 : item.amount;
    return convert(own, item.currency || currency, currency, rates);
  }

  /**
   * Fiyatların çevrileceği saatlik değer. `basis: 'leftover'` seçiliyse
   * sabit giderler maaştan düşülür: "bu ayakkabı, giderlerden sonra elinde
   * kalanın 3 günü".
   *
   * Giderler maaşı aşıyorsa kalan sıfır ya da eksi; o zaman bölme anlamsız
   * olur (sonsuz süre). Bu durumda maaşa dönülür ve `fallback` ile bildirilir,
   * panel kullanıcıya söyler.
   *
   * Dönüş: { perHour, basis: 'salary' | 'leftover', fallback: null | 'no-expenses' | 'overspent', skipped }
   * `skipped`: kuru olmadığı için hesaba katılamayan döviz gider sayısı.
   */
  function effectiveRate(settings, expenses, rates) {
    const perHour = hourlyRate(settings);
    if (!perHour) return null;

    const salaryRate = (fallback, skipped = 0) => ({ perHour, basis: 'salary', fallback, skipped });
    if (settings.basis !== 'leftover') return salaryRate(null);

    const list = Array.isArray(expenses) ? expenses : [];
    if (!list.length) return salaryRate('no-expenses');

    let total = 0;
    let skipped = 0;
    for (const item of list) {
      const monthly = expenseMonthly(item, settings.currency, rates);
      if (monthly === null) skipped++;
      else total += monthly;
    }

    const leftover = Number(settings.salary) - total;
    if (leftover <= 0) return salaryRate('overspent', skipped);

    const shift = shiftLengths(settings);
    return { perHour: leftover / shift.hoursPerMonth, basis: 'leftover', fallback: null, skipped };
  }

  // --- Süre ------------------------------------------------------------------

  /**
   * "1 gün" = bir günlük mesai, "1 ay" = bir aylık mesai.
   * Yani sınırlar kullanıcının kendi çalışma düzeninden gelir.
   */
  function shiftLengths(settings) {
    const perDay = Number(settings && settings.hoursPerDay);
    const daysPerMonth = Number(settings && settings.daysPerMonth);
    if (!perDay || !daysPerMonth || perDay <= 0 || daysPerMonth <= 0) return null;
    const hoursPerMonth = perDay * daysPerMonth;
    // Yıl = 12 aylık mesai. Herkesin 12 ay çalıştığı varsayılıyor; izin ve
    // tatil ayrı ayrı sorulmuyor, o kadar hassasiyet bu iş için gereksiz.
    return { hoursPerDay: perDay, hoursPerMonth, hoursPerYear: hoursPerMonth * 12 };
  }

  /**
   * Çalışma saatini en anlamlı birimde metne çevirir.
   * dk → saat → gün (bir mesai) → ay (bir aylık mesai) → yıl (12 aylık mesai)
   *
   * Yıl olmadan pahalı şeyler okunmaz oluyordu: bir araba "133 ay" diye
   * yazınca kimse kafasında bölmüyor, "11,1 yıl" ise anında oturuyor.
   */
  function formatDuration(hours, settings) {
    if (!Number.isFinite(hours) || hours < 0) return null;
    const shift = unitLengths(settings);
    if (!shift) return null;

    if (hours === 0) return 'yok';
    if (hours * 60 < 1) return '<1 dk';
    if (hours < 1) return `${Math.round(hours * 60)} dk`;
    if (hours < shift.hoursPerDay) return `${round(hours)} saat`;
    if (hours < shift.hoursPerMonth) return `${round(hours / shift.hoursPerDay)} gün`;
    if (hours < shift.hoursPerYear) return `${round(hours / shift.hoursPerMonth)} ay`;
    return `${round(hours / shift.hoursPerYear)} yıl`;
  }

  /**
   * Süre yazılırken "gün / ay / yıl"ın kaç saat sayılacağı.
   *
   *   dayUnit 'shift'    (varsayılan) 1 gün = bir mesai, 1 ay = bir aylık mesai
   *   dayUnit 'calendar' 1 gün = 24 saat, 1 ay = 30 gün, 1 yıl = 365 gün
   *
   * Yalnızca **yazımı** değiştirir; saatlik kazanç her iki durumda da mesai
   * saatinden hesaplanır (hourlyRate shiftLengths kullanır). Takvim modunda
   * "2 gün", 48 saat kesintisiz çalışma demek.
   */
  function unitLengths(settings) {
    const shift = shiftLengths(settings);
    if (!shift || !settings || settings.dayUnit !== 'calendar') return shift;
    return { hoursPerDay: 24, hoursPerMonth: 24 * 30, hoursPerYear: 24 * 365 };
  }

  /** 10'un altında bir ondalık, üstünde tam sayı. Türkçe virgül. */
  function round(value) {
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return rounded.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  }

  /**
   * Maaş alanını yazarken okunur tutar: "1000" → "1.000".
   *
   * `type="number"` ile yapılamıyor (tarayıcı ayraçlı değeri geçersiz sayar),
   * o yüzden alanlar `type="text" inputmode="numeric"`. İmleç, solundaki
   * rakam sayısı korunarak geri konuyor; yoksa her tuşta sona sıçrıyor.
   */
  function attachThousandSeparator(input, onChange) {
    const digitsBefore = (text, caret) => (text.slice(0, caret).match(/\d/g) || []).length;

    const format = (raw) => {
      const digits = String(raw).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      if (!digits) return '';
      return Number(digits).toLocaleString('tr-TR');
    };

    const apply = () => {
      const caret = input.selectionStart ?? input.value.length;
      const target = digitsBefore(input.value, caret);

      input.value = format(input.value);

      // Aynı sayıda rakamın sağına dön.
      let seen = 0;
      let position = input.value.length;
      for (let i = 0; i < input.value.length; i++) {
        if (/\d/.test(input.value[i])) seen++;
        if (seen === target) {
          position = i + 1;
          break;
        }
      }
      if (target === 0) position = 0;
      input.setSelectionRange(position, position);
    };

    input.addEventListener('input', () => {
      apply();
      onChange(parseAmount(input.value));
    });

    // Dışarıdan gelen ilk değeri de biçimle.
    input.value = format(input.value);
  }

  /** Saatlik kazanç: aylık maaş / (günlük saat × aylık gün). */
  function hourlyRate(settings) {
    const salary = Number(settings && settings.salary);
    const shift = shiftLengths(settings);
    if (!salary || salary <= 0 || !shift) return null;
    return salary / shift.hoursPerMonth;
  }

  function formatMoney(amount, currency) {
    const meta = CURRENCIES[currency];
    if (!meta) return String(amount);
    return amount.toLocaleString('tr-TR', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    });
  }

  const DEFAULT_SETTINGS = {
    enabled: true,
    salary: null,
    currency: 'TRY',
    hoursPerDay: 8,
    daysPerMonth: 22,
    disabledHosts: [],
    // Sistem karanlık olsa bile aydınlık açılır; karanlık bilinçli bir tercih.
    theme: 'light',
    // 'salary': maaşın tamamına göre · 'leftover': sabit giderler düşüldükten sonra
    basis: 'salary',
    // 'time': fiyat yerine süre · 'both': "1,8 saat (500 TL)"
    display: 'time',
    // 'shift': 1 gün = bir mesai · 'calendar': 1 gün = 24 saat (bkz. unitLengths)
    dayUnit: 'shift',
  };

  root.IVD = {
    CURRENCIES,
    DEFAULT_SETTINGS,
    shiftLengths,
    unitLengths,
    expenseMonthly,
    effectiveRate,
    attachThousandSeparator,
    createPriceRegex,
    readMatch,
    parseAmount,
    convert,
    formatDuration,
    formatMoney,
    hourlyRate,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
