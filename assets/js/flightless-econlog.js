// Flightless — economy log.
//
// A plain-text ledger of every purchase and flight payout, kept in its own
// localStorage key (never touches the save schema/migrations in
// flightless-save.js) so it can be exported or cleared without any risk to
// progress. Exists purely so a player can play a stretch of days and hand a
// readable log to someone else for balance tuning — every entry records the
// day it happened on and the resulting balance, so the whole thing reads
// like a bank statement.
const LOG_KEY = 'flightless-econlog-v1';

export function createEconLog(state){
  let entries = [];
  try{
    const raw = localStorage.getItem(LOG_KEY);
    if(raw){ const parsed = JSON.parse(raw); if(Array.isArray(parsed)) entries = parsed; }
  }catch(e){ entries = []; }

  function persist(){
    try{ localStorage.setItem(LOG_KEY, JSON.stringify(entries)); }catch(e){ /* storage full/blocked — log stays in memory */ }
  }

  // name/id: the upgrade or gear bought. cost: what was paid. lvl: the
  // resulting level (or a string like 'owned' for one-shot gear).
  function logBuy({ name, id, cost, lvl, currency }){
    entries.push({
      t:'buy', day: state.day, name, id, cost, lvl,
      currency: currency || '$',
      balance: currency === 'BP' ? state.bp : state.money,
    });
    persist();
  }

  function logRefund({ name, id, refund, currency }){
    entries.push({
      t:'refund', day: state.day, name, id, refund,
      currency: currency || 'BP',
      balance: currency === 'BP' ? state.bp : state.money,
    });
    persist();
  }

  // Call AFTER state.money has already been credited for the flight, so
  // `balance` is the money the player actually has heading into the shop.
  function logFlight({ dist, alt, spd, earned, breakdown }){
    entries.push({ t:'flight', day: state.day, dist, alt, spd, earned, breakdown, balance: state.money });
    persist();
  }

  function clear(){ entries = []; persist(); }

  function toText(){
    if(!entries.length){
      return '(no entries yet — buy an upgrade or fly a day to start recording)';
    }
    const lines = ['=== FLIGHTLESS ECONOMY LOG ===', `exported ${new Date().toISOString()}`, ''];
    let curDay = null;
    for(const e of entries){
      if(e.day !== curDay){ curDay = e.day; lines.push(`Day ${curDay}`); }
      if(e.t === 'buy'){
        lines.push(`  BUY    ${String(e.name).padEnd(16)} lvl→${e.lvl}   -${e.cost}${e.currency}   bal ${Math.round(e.balance)}${e.currency}`);
      } else if(e.t === 'refund'){
        lines.push(`  REFUND ${String(e.name).padEnd(16)}          +${e.refund}${e.currency}   bal ${Math.round(e.balance)}${e.currency}`);
      } else if(e.t === 'flight'){
        const b = e.breakdown || {};
        const parts = Object.entries(b).filter(([,v]) => v).map(([k,v]) => `${k}:${Math.round(v)}`).join(' ');
        lines.push(`  FLIGHT dist ${Math.round(e.dist)}m alt ${Math.round(e.alt)}m spd ${Math.round(e.spd)}m/s  earned +$${Math.round(e.earned)} (${parts})  bal $${Math.round(e.balance)}`);
      }
    }
    return lines.join('\n');
  }

  return { logBuy, logRefund, logFlight, clear, toText, get entries(){ return entries; } };
}
