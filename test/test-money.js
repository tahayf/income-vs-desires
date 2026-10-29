require('../src/lib/money.js');
const IVD = globalThis.IVD;

let fail = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${actual}${ok ? '' : `  (beklenen: ${expected})`}`);
}

console.log('--- parseAmount ---');
check('500', IVD.parseAmount('500'), 500);
check('19.99', IVD.parseAmount('19.99'), 19.99);
check('19,99', IVD.parseAmount('19,99'), 19.99);
check('1.299,90', IVD.parseAmount('1.299,90'), 1299.9);
check('1,299.90', IVD.parseAmount('1,299.90'), 1299.9);
check('1.500', IVD.parseAmount('1.500'), 1500);
check('1,500', IVD.parseAmount('1,500'), 1500);
check('1.234.567', IVD.parseAmount('1.234.567'), 1234567);
check('12 999,50', IVD.parseAmount('12 999,50'), 12999.5);

console.log('\n--- fiyat yakalama ---');
const samples = [
  ['Ayakkabı 500 TL indirimde', [[500, 'TRY']]],
  ['Fiyat: ₺1.299,90', [[1299.9, 'TRY']]],
  ['$19.99 only', [[19.99, 'USD']]],
  ['Toplam 249,90 €', [[249.9, 'EUR']]],
  ['£45 / £60', [[45, 'GBP'], [60, 'GBP']]],
  ['OUTLET 2024 koleksiyonu', []],
  ['3 adet kaldı', []],
  ['Kargo bedava, 1.500 TL üzeri', [[1500, 'TRY']]],
  // React'in boşluksuz böldüğü hal
  ['811,41TL', [[811.41, 'TRY']]],
  ['TL811,41', [[811.41, 'TRY']]],
  ['1.599,59TL', [[1599.59, 'TRY']]],
  // kelime sınırı hâlâ korunmalı
  ['TRYING 500 adet', []],
  ['100 TLC kodu', []],
  ['EURO 500 metre', []],
  ['HTL 500 oda', []],
  ['OUTLET2024 kampanya', []],
  // normal boşluk binlik ayracı DEĞİL — "Beden 42 500 TL" 42.500 sanılmamalı
  ['Beden 42 500 TL', [[500, 'TRY']]],
  ['Stok 12 1.500 TL', [[1500, 'TRY']]],
  // kırılmaz / dar boşluk bilerek konur, ayraç sayılır
  ['12 999,50 TL', [[12999.5, 'TRY']]],
  ['1 250 TL', [[1250, 'TRY']]],
  // iki fiyat satır içi yan yana (Trendyol: indirimli + üstü çizili)
  ['11.999,96 TL29.999,90 TL', [[11999.96, 'TRY'], [29999.9, 'TRY']]],
  ['1.399,99 TL2.499,99 TL', [[1399.99, 'TRY'], [2499.99, 'TRY']]],
  ['850 TL900 TL', [[850, 'TRY'], [900, 'TRY']]],
  // harf komşuluğu hâlâ yasak
  ['500 TLsize özel', []],
  // sayının ortasından başlayan eşleşme yok — Amazon fırsat kartı "3.499"+"00"+"TL"
  ['3.49900TL', []],
  ['1.29990 TL', []],
  ['3.499,00TL', [[3499, 'TRY']]],
  ['1,299.00$', [[1299, 'USD']]],
  // küçük harfli kodlar para birimi değil — "try 3 times" TRY 3 sanılmamalı
  ['try 3 times', []],
  ['please try 2 more', []],
  ['5 tl kaldı', []],
  ['eur 20 metre', []],
];
for (const [text, expected] of samples) {
  const re = IVD.createPriceRegex();
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const p = IVD.readMatch(m);
    if (p) found.push([p.amount, p.currency]);
  }
  check(JSON.stringify(text), JSON.stringify(found), JSON.stringify(expected));
}

console.log('\n--- süre: tam zamanlı (50.000 TL/ay, 8 saat x 22 gün = 176 saat) ---');
const fullTime = { salary: 50000, currency: 'TRY', hoursPerDay: 8, daysPerMonth: 22 };
const perHour = IVD.hourlyRate(fullTime);
check('saatlik', Math.round(perHour * 100) / 100, 284.09);
const show = (tl) => IVD.formatDuration(tl / perHour, fullTime);
check('50 TL', show(50), '11 dk');
check('500 TL', show(500), '1,8 saat');
check('2.000 TL', show(2000), '7 saat');
check('tam 1 mesai', show(perHour * 8), '1 gün');
check('20.000 TL', show(20000), '8,8 gün');
check('tam 1 maaş', show(50000), '1 ay');
check('600.000 TL', show(600000), '1 yıl');
check('araba 1.850.000 TL', show(1850000), '3,1 yıl');
check('tam 12 aylık mesai', IVD.formatDuration(8 * 22 * 12, fullTime), '1 yıl');
check('bir tık altı', IVD.formatDuration(8 * 22 * 12 - 0.01, fullTime), '12 ay');

console.log('\n--- süre: farklı düzen (12 saat x 15 gün = 180 saat) ---');
const shifts = { salary: 50000, currency: 'TRY', hoursPerDay: 12, daysPerMonth: 15 };
check('saatlik', Math.round(IVD.hourlyRate(shifts) * 100) / 100, 277.78);
check('11 saat', IVD.formatDuration(11, shifts), '11 saat');
check('12 saat = 1 mesai', IVD.formatDuration(12, shifts), '1 gün');
check('180 saat = 1 ay', IVD.formatDuration(180, shifts), '1 ay');

console.log('\n--- eksik ayar ---');
check('maaş yok', IVD.hourlyRate({ hoursPerDay: 8, daysPerMonth: 22 }), null);
check('gün yok', IVD.hourlyRate({ salary: 50000, hoursPerDay: 8 }), null);

console.log('\n--- kur çevrimi ---');
const rates = { EUR: 1, USD: 1.08, GBP: 0.85, TRY: 45 };
check('100 USD → TRY', Math.round(IVD.convert(100, 'USD', 'TRY', rates)), 4167);
check('100 TRY → TRY', IVD.convert(100, 'TRY', 'TRY', rates), 100);
// Koda gömülü yedek tablo yok: kur hiç çekilmediyse döviz çevrilmez.
check('kur yok: döviz → null', IVD.convert(100, 'USD', 'TRY', null), null);
check('kur yok: aynı birim çalışır', IVD.convert(100, 'TRY', 'TRY', null), 100);
check('FALLBACK_RATES kaldırıldı', IVD.FALLBACK_RATES, undefined);

console.log('\n--- gider ---');
check('aylık TL', IVD.expenseMonthly({ amount: 600, period: 'monthly', currency: 'TRY' }, 'TRY', rates), 600);
check('yıllık TL → aylık', IVD.expenseMonthly({ amount: 1200, period: 'yearly', currency: 'TRY' }, 'TRY', rates), 100);
check('20 USD → TL', Math.round(IVD.expenseMonthly({ amount: 20, period: 'monthly', currency: 'USD' }, 'TRY', rates)), 833);
check('birimsiz eski kayıt maaş biriminde', IVD.expenseMonthly({ amount: 500, period: 'monthly' }, 'TRY', null), 500);
check('kur yoksa döviz gider null', IVD.expenseMonthly({ amount: 20, period: 'monthly', currency: 'USD' }, 'TRY', null), null);

console.log('\n--- giderlerden sonra kalana göre ---');
const leftover = { ...fullTime, basis: 'leftover' };
const giderler = [
  { amount: 20000, period: 'monthly', currency: 'TRY' }, // kira
  { amount: 1200, period: 'yearly', currency: 'TRY' },   // ayda 100
];
const r1 = IVD.effectiveRate(leftover, giderler, rates);
// (50.000 - 20.100) / 176 = 169,89
check('kalan saatlik', Math.round(r1.perHour * 100) / 100, 169.89);
check('kalan: basis', r1.basis, 'leftover');
check('kalan: 500 TL', IVD.formatDuration(500 / r1.perHour, leftover), '2,9 saat');
check('seçili değilse maaş', IVD.effectiveRate(fullTime, giderler, rates).perHour, perHour);
check('gider yoksa maaşa döner', IVD.effectiveRate(leftover, [], rates).fallback, 'no-expenses');
const asim = IVD.effectiveRate(leftover, [{ amount: 60000, period: 'monthly', currency: 'TRY' }], rates);
check('giderler maaşı aşarsa maaşa döner', [asim.basis, asim.fallback, asim.perHour === perHour], ['salary', 'overspent', true]);
const kursuz = IVD.effectiveRate(leftover, [...giderler, { amount: 20, period: 'monthly', currency: 'USD' }], null);
check('kursuz döviz gider atlanır', [kursuz.skipped, Math.round(kursuz.perHour * 100) / 100], [1, 169.89]);
check('maaş yoksa null', IVD.effectiveRate({ ...leftover, salary: null }, giderler, rates), null);

console.log('\n--- gün birimi: 24 saat ---');
const takvim = { ...fullTime, dayUnit: 'calendar' };
check('saatlik değişmez', IVD.hourlyRate(takvim), perHour);
check('16 saat → mesai: 2 gün', IVD.formatDuration(16, fullTime), '2 gün');
check('16 saat → takvim: 16 saat', IVD.formatDuration(16, takvim), '16 saat');
check('48 saat → takvim: 2 gün', IVD.formatDuration(48, takvim), '2 gün');
check('720 saat → takvim: 1 ay', IVD.formatDuration(720, takvim), '1 ay');
check('8760 saat → takvim: 1 yıl', IVD.formatDuration(8760, takvim), '1 yıl');
// 6.512 saat / 720 = 9,04 ay (mesai biriminde aynı fiyat "3,1 yıl")
check('araba 1.850.000 TL → takvim', IVD.formatDuration(1850000 / perHour, takvim), '9 ay');

console.log(fail === 0 ? '\nHepsi geçti.' : `\n${fail} test başarısız.`);
process.exit(fail ? 1 : 0);
