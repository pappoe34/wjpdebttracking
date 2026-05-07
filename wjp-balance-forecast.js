/* ============================================================================
   WJP Balance Forecast (W3) — predicts cash flow against scheduled bills.
   Reads from app's bills + transactions + linked bank balances.
   Outputs daily projected balance for next 30 days.
   Surfaces warnings: "you'll be short $X on the 27th."
   ============================================================================ */
(function () {
  'use strict';
  if (window.WJP_BalanceForecast) return;

  function forecast({ startBalance, recurringBills = [], expectedIncome = [], days = 30 }) {
    if (typeof startBalance !== 'number') return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const series = [];
    let bal = startBalance;
    const lows = [];

    for (let d = 0; d < days; d++) {
      const date = new Date(today.getTime() + d * 86400000);
      const dom = date.getDate();

      // Apply incoming
      expectedIncome.forEach(i => {
        if (matchSchedule(i, date, today)) bal += Number(i.amount) || 0;
      });

      // Apply outgoing (recurring bills)
      recurringBills.forEach(b => {
        if (matchSchedule(b, date, today)) bal -= Number(b.amount) || 0;
      });

      series.push({ date: date.toISOString().slice(0, 10), balance: Math.round(bal * 100) / 100 });

      if (bal < 0) lows.push({ date: date.toISOString().slice(0, 10), shortage: Math.abs(bal) });
    }

    return { series, lows, finalBalance: bal };
  }

  function matchSchedule(item, date, today) {
    if (!item) return false;
    const { dueDay, frequency, dayOfWeek, dueDate } = item;

    if (dueDate) {
      const d = new Date(dueDate);
      return d.toISOString().slice(0, 10) === date.toISOString().slice(0, 10);
    }
    if (frequency === 'monthly' && dueDay) {
      return date.getDate() === Number(dueDay);
    }
    if (frequency === 'weekly' && dayOfWeek != null) {
      return date.getDay() === Number(dayOfWeek);
    }
    if (frequency === 'biweekly' && dueDay) {
      const elapsed = Math.floor((date - today) / 86400000);
      return elapsed % 14 === 0 && date.getDate() === Number(dueDay);
    }
    return false;
  }

  // Pull from appState if available
  function fromAppState() {
    if (!window.appState) return null;
    const a = window.appState;
    let bal = 0;
    if (a.linkedBanks && Array.isArray(a.linkedBanks)) {
      bal = a.linkedBanks.reduce((s, x) => s + (Number(x.balance) || 0), 0);
    }
    const bills = (a.recurringBills || a.bills || []).map(b => ({
      amount: b.amount || b.cost,
      dueDay: b.dueDay || b.day,
      frequency: b.frequency || 'monthly',
      name: b.name
    }));
    const income = (a.income || []).map(i => ({
      amount: i.amount,
      dueDay: i.dueDay || i.day,
      frequency: i.frequency || 'monthly',
      name: i.name
    }));
    return forecast({ startBalance: bal, recurringBills: bills, expectedIncome: income, days: 30 });
  }

  function summary() {
    const f = fromAppState();
    if (!f) return null;
    const negDays = f.lows.length;
    const worstShortage = Math.max(0, ...f.lows.map(l => l.shortage));
    return {
      finalBalance: f.finalBalance,
      negativeDays: negDays,
      worstShortage,
      firstNegativeDate: f.lows.length ? f.lows[0].date : null,
      series: f.series
    };
  }

  window.WJP_BalanceForecast = { forecast, fromAppState, summary };
})();
