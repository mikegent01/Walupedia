// The running-deadline ledger and the time-passed readout are derived from
// filings' timeCodes. Pulls the pure functions out of index.html and checks
// them against the committed events bundle.
import fs from 'fs';
import assert from 'assert';
const html=fs.readFileSync('index.html','utf8');
const grab=(a,b)=>{const i=html.indexOf(a);assert(i>=0,a);const j=html.indexOf(b,i);return html.slice(i,j);};
const code=[grab('function parseTimeCode(','function timeCodePill('),
            grab('function deadlineDayNumber(','function deadlineBannerHtml(')].join('\n');
const ev=JSON.parse(fs.readFileSync('Reputation-Matrix2/data/events.json','utf8'));
const meta=JSON.parse(fs.readFileSync('Reputation-Matrix2/data/calendarMeta.json','utf8'));
const DATA={events:Array.isArray(ev)?ev:ev.events,calendarMeta:meta};
const api=new Function('DATA',code+';return {deadlineRemaining,deadlineMovers,spanText,deadlineMoverTags};')(DATA);
const live=meta.deadlines.filter(d=>d.status!=='resolved');
assert(live.length,'no live deadline to test');
for(const d of live){
  const r=api.deadlineRemaining(d), mv=api.deadlineMovers(d);
  assert(r.eDays*1440+r.eHH*60+r.eMM===Math.min(r.elapsedMin,r.totalMin),d.id+': elapsed readout');
  assert(!('elapsedDays' in d),d.id+': stored counter');
  if(d.startedBy&&DATA.events.some(e=>e.id===d.startedBy)){
    assert(mv[0]&&mv[0].start&&mv[0].ev.id===d.startedBy,d.id+': ledger opens on startedBy');
  }
  for(let i=1;i<mv.length;i++) assert(mv[i].off>=mv[i-1].off,d.id+': ledger ordered');
  console.log('OK  '+d.id+': '+mv.length+' ledger rows, '+api.spanText(r.elapsedMin)+' passed');
}
assert.strictEqual(api.spanText(210),'3h 30m');
assert.strictEqual(api.spanText(1500),'1d 1h 0m');
console.log('ALL DEADLINE TESTS PASS');
