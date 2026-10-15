// unMineable /v1/dashboard/events: https://unmineable.com/api
// Amounts stay in fixed-point integers; Number is only used for chart display.
const SCALE = 10n ** 18n;
const DAY = 86400000;
export function units(value) {
  if (typeof value !== 'string' || !/^\d{1,30}(\.\d{1,18})?$/.test(value)) {
    throw Error('奖励金额格式异常，未生成统计');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, '0'));
}
function amount(value) {
  const fraction = (value % SCALE).toString().padStart(18, '0').replace(/0+$/, '').padEnd(8, '0');
  return `${value / SCALE}.${fraction}`;
}
export function dateRange({from, to, timeZone}, now = Date.now()) {
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to)) throw Error('请选择有效的开始和结束日期');
  if (from > to) throw Error('开始日期不能晚于结束日期');
  if (typeof timeZone !== 'string' || timeZone.length > 80) throw Error('统计时区无效');
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit'}); }
  catch { throw Error('统计时区无效'); }
  const dayOf = time => {
    const p = Object.fromEntries(formatter.formatToParts(time).map(p => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  if (to > dayOf(now)) throw Error('结束日期不能晚于今天');
  const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  if (days > 366) throw Error('一次最多查询 366 天，请缩小日期范围');
  return {from, to, timeZone, days, dayOf};
}

export async function collectRewards(requestPage, selection, now = Date.now()) {
  const range = dateRange(selection, now);
  const rows = new Map();
  for (let time = Date.parse(range.from); time <= Date.parse(range.to); time += DAY) {
    rows.set(new Date(time).toISOString().slice(0, 10), {value:0n, count:0});
  }
  const seen = new Map();
  let total = 0n, count = 0, previousTime = Infinity, complete = false;
  // Bound expensive queries; never present an incomplete page set as a total.
  for (let page = 1; page <= 100; page++) {
    const payload = await requestPage(page);
    const data = payload?.data;
    if (payload?.success !== true || !Array.isArray(data?.list) || typeof data.has_next !== 'boolean') {
      throw Error('矿池奖励记录格式异常，未生成统计');
    }
    if (!data.list.length && data.has_next) throw Error('矿池分页记录不完整，请稍后重试');
    let beforeRange = false;
    for (const event of data.list) {
      if (typeof event?.uuid !== 'string' || !event.uuid || !Number.isSafeInteger(event.timestamp)
        || event.timestamp < 0 || event.timestamp > 8640000000000000 || typeof event.event !== 'string') {
        throw Error('矿池奖励记录缺少有效时间或标识，未生成统计');
      }
      const fingerprint = JSON.stringify(event);
      if (seen.has(event.uuid)) {
        if (seen.get(event.uuid) !== fingerprint) throw Error('矿池记录正在变化，请重新查询');
        continue;
      }
      seen.set(event.uuid, fingerprint);
      if (event.timestamp > previousTime) throw Error('矿池记录排序异常，请重新查询');
      previousTime = event.timestamp;
      const date = range.dayOf(event.timestamp);
      if (date < range.from) { beforeRange = true; continue; }
      if (date > range.to || event.timestamp > now || event.event !== 'reward') continue;
      // A reward event can distribute to several coins. The live API puts
      // amounts in data.coins; retain compatibility with single-coin events.
      const coins = event.data?.coins === undefined ? [event.data] : event.data.coins;
      if (!Array.isArray(coins) || !coins.length) throw Error('矿池奖励币种列表异常，未生成统计');
      let value = 0n, hasLtc = false;
      for (const coin of coins) {
        if (typeof coin?.coin !== 'string' || !coin.coin) throw Error('矿池奖励记录缺少币种，未生成统计');
        if (coin.coin !== 'LTC') continue;
        value += units(coin.amount);
        hasLtc = true;
      }
      if (!hasLtc) continue;
      const row = rows.get(date);
      row.value += value; row.count++; total += value; count++;
    }
    if (beforeRange || !data.has_next) { complete = true; break; }
  }
  if (!complete) throw Error('记录较多，尚未读取完整区间。请缩小日期范围后重试');
  return {
    from:range.from, to:range.to, timeZone:range.timeZone, days:range.days,
    // Round the daily average to one litoshi (8 decimal places).
    total:amount(total), average:amount((total + BigInt(range.days) * 10n ** 10n / 2n) / (BigInt(range.days) * 10n ** 10n) * 10n ** 10n), count,
    daily:[...rows].map(([date, row]) => ({date, amount:amount(row.value), count:row.count})),
    syncedAt:now, scope:'account', source:'unmineable-reward-events'
  };
}
