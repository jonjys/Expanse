(() => {
'use strict';
/* Expanse admin. Every call goes to an admin_* RPC with the admin key; the database checks the key's hash. */
const SUPA = { url: 'https://gjmkhnrgznorxxaemsmo.supabase.co', key: 'sb_publishable_b1uzRroOaHTGp9oXOhHjtQ_J-A-IUCZ' };
const SITE = 'https://expanse.nyttolabs.com';
const KEY_STORE = 'expanse.admin.v1';
const CATS = {
  productivity: ['Productivity', '#c8ff3d'], developer: ['Developer tools', '#5ee1ff'], design: ['Design', '#ff5c7a'],
  marketing: ['Marketing & sales', '#ffcf4a'], finance: ['Finance & admin', '#3dff8a'], ai: ['AI', '#b39cff'],
  commerce: ['E-commerce', '#ff9f43'], education: ['Education', '#7aa8ff'], health: ['Health & wellbeing', '#ff7ad9'], other: ['Other', '#c3caf0']
};
const PRICING = { unspecified: 'Not specified', free: 'Free', freemium: 'Free plan', trial: 'Free trial', paid: 'Paid' };
const PLATFORMS = { web: 'Web', ios: 'iOS', android: 'Android', macos: 'macOS', windows: 'Windows', linux: 'Linux', api: 'API', extension: 'Browser extension' };
const STATUS = { pending: 'In review', approved: 'Live', rejected: 'Changes needed', hidden: 'Hidden', removed: 'Removed' };
const REASONS = { broken_link: 'The link is broken', wrong_info: 'Information is wrong', spam: 'Spam, scam or harmful', other: 'Something else' };
const PRESETS = {
  rejected: ['The website link doesn’t work.', 'The description doesn’t match the website.', 'Please describe what the product does in plain words.', 'We only list software products and tools.', 'This looks like a duplicate of an existing listing.'],
  hidden: ['The website hasn’t answered for several days.', 'Visitors reported wrong information — we’re checking.', 'Reported as spam or harmful — we’re checking.']
};

const $ = s => document.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('en');
const ago = iso => { if (!iso) return '—'; const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
const day = iso => { try { return new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short' }); } catch (e) { return ''; } };
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}
// replaceChildren would print "null" for an empty slot; this skips them.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(3).filter(k => k != null && k !== false));
const store = {
  get() { try { return sessionStorage.getItem(KEY_STORE) || localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } },
  set(k, remember) { try { sessionStorage.setItem(KEY_STORE, k); if (remember) localStorage.setItem(KEY_STORE, k); } catch (e) {} },
  clear() { try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE); } catch (e) {} }
};
let toastT = 0;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), err ? 5200 : 3200); }

let KEY = store.get();
async function rpc(fn, args) {
  const r = await fetch(SUPA.url + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPA.key }, body: JSON.stringify(Object.assign({ p_key: KEY }, args || {})) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) {
    const m = (j && j.message) || 'error ' + r.status;
    if (m === 'bad_admin') { signOut(true); }
    throw new Error(m);
  }
  return j;
}

/* ---------- sign in ---------- */
function showLogin(msg) {
  $('#shell').hidden = true; $('#login').hidden = false;
  if (msg) toast(msg, true);
  setTimeout(() => $('#keyIn').focus(), 50);
}
function signOut(expired) { KEY = ''; store.clear(); showLogin(expired ? 'That admin key doesn’t work (any more). Sign in again.' : null); }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const k = $('#keyIn').value.trim(); if (k.length < 20) { toast('Paste the whole admin key.', true); return; }
  const b = $('#loginBtn'); b.disabled = true; b.textContent = 'Checking…';
  KEY = k;
  try { await rpc('admin_settings'); store.set(k, $('#remember').checked); $('#keyIn').value = ''; start(); }
  catch (err) { if (err.message !== 'bad_admin') toast('Couldn’t reach the database — try again.', true); }
  finally { b.disabled = false; b.textContent = 'Sign in'; }
});
$('#signOut').onclick = () => signOut(false);

async function renderMapPurchases(main) {
  const rows=await rpc('admin_map_purchases'); if(tab!=='map-purchases')return;
  main.replaceChildren(el('h2',{class:'display',text:'Map purchases'}),el('p',{class:'sub',text:'Stripe-confirmed map placements. These do not change search ranking or Spotlight. Payments marked for review need a check in Stripe before any refund or activation.'}));
  if(!rows.length){main.append(el('div',{class:'empty',text:'No map purchases yet. Never count a reservation or an unpaid checkout as revenue.'}));return;}
  for(const row of rows)main.append(el('article',{class:'prod'},el('h3',{text:row.name}),el('p',{text:`${row.zone} · ${row.size}×${row.size} · €${(row.amount_cents/100).toLocaleString('en')} · ${row.state}`}),el('p',{class:'sub',text:row.ends_at?'Placement ends '+day(row.ends_at):'Created '+ago(row.created_at)}),row.review_events?el('p',{class:'note',text:`${row.review_events} payment event(s) need manual review.`}):null,row.issue?el('p',{text:row.issue}):null,row.session_id?el('a',{class:'linkbtn',href:'https://dashboard.stripe.com/payments/'+encodeURIComponent(row.payment_intent||''),target:'_blank',rel:'noopener',text:'Open payment in Stripe ↗'}):null));
}
async function renderWithdrawals(main) {
 const rows=await rpc('admin_withdrawals');if(tab!=='withdrawals')return;
 main.replaceChildren(el('h2',{class:'display',text:'Withdrawal notices'}),el('p',{class:'sub',text:'Check the original Stripe payment and deadline, refund in Stripe, and reply to the customer. Marking handled does not issue a refund.'}));
 if(!rows.length)main.append(el('div',{class:'empty',text:'No withdrawal notices.'}));
 for(const row of rows){const note=el('textarea',{rows:'3',maxlength:'1000',placeholder:'Action taken, refund reference and customer reply'}),card=el('article',{class:'pc'},el('h3',{text:row.resolved_at?'Handled':'Needs review'}),el('p',{text:`Received ${new Date(row.created_at).toISOString()} · ${row.name}`}),el('p',{text:`Contract: ${row.reference}`}),el('p',{text:row.message||'No message supplied.'}),el('p',{class:'sub',text:row.receipt_sent_at?'Acknowledgement accepted by email provider. Inbox delivery is not confirmed.':row.receipt_failed_at?'Acknowledgement email failed — check outbox and contact customer.':'Acknowledgement email queued.'}),el('a',{href:'mailto:'+row.email,text:'Reply to '+row.email}),row.payment_intent?el('a',{class:'linkbtn',href:'https://dashboard.stripe.com/payments/'+encodeURIComponent(row.payment_intent),target:'_blank',rel:'noopener',text:'Check payment / refund in Stripe ↗'}):el('p',{class:'sub',text:'No automatic order match. Locate the payment before taking action.'}));
  if(row.admin_note)card.append(el('p',{text:row.admin_note}));
  if(!row.resolved_at)card.append(note,el('button',{class:'btn btn-primary btn-sm',text:'Mark handled',onclick:async e=>{if(note.value.trim().length<5){toast('Record the action taken first.',true);return;}const btn=e.currentTarget;btn.disabled=true;try{await rpc('admin_resolve_withdrawal',{p_id:row.id,p_note:note.value});toast('Marked handled. No payment action was performed.');go('withdrawals');}catch(err){toast('Could not save: '+err.message,true);btn.disabled=false;}}}));main.append(card);
 }
}
function sellerPanel(s) {
 const fields={},panel=el('form',{class:'panel'},el('h3',{text:'Public seller details'}),el('p',{class:'sub',text:'These details appear publicly on Seller, Terms and Privacy pages. Publication is separate from the payments switch. For a sole proprietor, the registration number may be a personal identity number: the proprietor must explicitly authorize publishing it.'}));
 for(const [key,label]of [['legal_name','Legal name / trading name'],['registration_number','Registration number'],['address','Postal and complaints address'],['email','Support email'],['phone','Phone']]){fields[key]=el(key==='address'?'textarea':'input',{name:key,type:key==='email'?'email':'text',required:true,maxlength:key==='address'?'300':key==='registration_number'?'40':key==='phone'?'50':key==='email'?'254':'160'});fields[key].value=s[key]||'';panel.append(el('label',{class:'field'},el('span',{text:label}),fields[key]));}
 const publish=el('input',{type:'checkbox',name:'published'});publish.checked=!!s.published;panel.append(el('label',{class:'check'},publish,' I authorize publishing these details, including any personal identity number and address, on this public website.'));
 const submit=el('button',{class:'btn btn-primary btn-sm',type:'submit',text:'Save seller details'});panel.append(submit,el('p',{class:'sub',text:'Current state: '+(s.published?'published':'private / not published')}));
 panel.onsubmit=async e=>{e.preventDefault();if(!panel.reportValidity())return;submit.disabled=true;const p={published:publish.checked};for(const key in fields)p[key]=fields[key].value.trim();try{await rpc('admin_save_seller',{p});toast(p.published?'Seller details published.':'Saved privately. No seller details were published.');go('settings');}catch(err){toast('Could not save: '+err.message,true);submit.disabled=false;}};return panel;
}

/* ---------- shell ---------- */
let tab = 'queue';
async function renderSeasonalOffers(main){
 const rows=await rpc('admin_seasonal_offers');if(tab!=='offers')return;
 fill(main,el('h2',{class:'display',text:'Seasonal offer review'}),el('p',{class:'sub',text:'Review real terms and supporting price history. Do not approve unsupported discounts. Public offers expire automatically and never influence organic ranking.'}));
 if(!rows.length)main.append(el('p',{class:'empty',text:'No active offer submissions.'}));
 for(const row of rows){const ack=el('input',{type:'checkbox'}),status=el('p',{class:'sub',role:'status'}),card=el('article',{class:'panel'},el('h3',{text:row.name+' · '+row.state}),el('b',{text:row.title}),el('p',{text:row.details}),el('p',{text:row.starts_at+' → '+row.ends_at}),el('p',{text:'Private evidence note: '+row.evidence_note}));for(const [label,url]of [['Offer page',row.offer_url],['Evidence page',row.evidence_url]]){try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password)card.append(el('a',{class:'linkbtn',href:u.href,target:'_blank',rel:'noopener nofollow',text:label+' ↗'}));}catch{}}
 card.append(el('label',{class:'check'},ack,' I checked the actual offer, availability, supporting price history and applicable prior-price disclosures. The claims are supported.'),el('div',{class:'row'},...[true,false].map(approve=>el('button',{class:'btn '+(approve?'primary':''),text:approve?'Approve evidence-reviewed offer':'Decline / remove',onclick:async()=>{if(approve&&!ack.checked){status.textContent='Check the evidence and acknowledge the review first.';return;}try{await rpc('admin_review_offer',{p_slug:row.slug,p_approve:approve,p_evidence_checked:ack.checked});go('offers');}catch{status.textContent='Could not save review. Check verified ownership, dates and acknowledgement.';}}}))),status);main.append(card);}
}
async function renderGrowthMetrics(main){const m=await rpc('admin_growth_metrics');if(tab!=='growth')return;const labels={approved_products:'Approved real products',median_review_hours:'Median submission → approval (hours)',studio_products_30:'Products opening Growth Studio / 30d',kit_products_30:'Products opening kit / 30d',asset_copy_products_30:'Products copying assets / 30d',download_products_30:'Products downloading PNG / 30d',returning_studio_products_30:'Products returning on multiple days / 30d',campaign_reached_products_30:'Products with recorded campaign visitors / 30d',outbound_clicks_30:'Daily unique outbound website clicks / 30d',paid_map_orders:'Stripe-confirmed map orders',stripe_confirmed_gross_eur:'Stripe-confirmed gross map payments (EUR)'};fill(main,el('h2',{class:'display',text:'Marketplace growth · real observations'}),el('p',{class:'sub',text:'Usage collection starts with Growth Studio 2.0. Product counts are not unique maker counts. Copy/download actions do not prove a post was published.'}),el('div',{class:'panel'},Object.entries(labels).map(([key,label])=>el('p',null,el('b',{text:label+': '}),m[key]===null?'Not measured':String(m[key]??'Unavailable')))),el('p',{class:'sub',text:m.unique_makers_note}),el('p',{class:'sub',text:m.revenue_note}));}

const TABS = { offers:renderSeasonalOffers, growth:renderGrowthMetrics, needs: renderToolNeeds, withdrawals: renderWithdrawals, 'map-purchases': renderMapPurchases, queue: renderQueue, reports: renderReports, placements: renderPlacements, products: renderProducts, overview: renderOverview, settings: renderSettings };
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });
$('#refresh').onclick = () => { go(tab); counts(); };
function go(t) {
  tab = TABS[t] ? t : 'queue';
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  try { history.replaceState(null, '', '#' + tab); } catch (e) {}
  const main = $('#main'); main.replaceChildren(el('p', { class: 'loading', text: 'Loading…' }));
  TABS[tab](main).catch(err => { if (err.message !== 'bad_admin') main.replaceChildren(el('div', { class: 'empty' }, el('b', { text: 'Couldn’t load this.' }), err.message)); });
}
async function counts() {
  try {
    const o = await rpc('admin_overview');
    const q = (o.counts.pending | 0), r = o.open_reports | 0;
    const nq = $('#nQueue'); nq.textContent = q; nq.hidden = !q;
    const nr = $('#nReports'); nr.textContent = r; nr.hidden = !r;
    const pl = (o.placements && o.placements.requested) | 0, np = $('#nPlace'); np.textContent = pl; np.hidden = !pl;
    document.title = (q + r + pl ? `(${q + r + pl}) ` : '') + 'Expanse admin';
    return o;
  } catch (e) { return null; }
}
function start() {
  $('#login').hidden = true; $('#shell').hidden = false;
  const h = location.hash.slice(1); go(TABS[h] ? h : 'queue'); counts();
}

/* ---------- product card ---------- */
function statusBadge(s) { return el('span', { class: 'badge st-' + s, text: STATUS[s] || s }); }
function check(label, ok, status, at, fails, lastOk) {
  if (!at) return el('span', { class: 'ck' }, el('i'), `${label}: not checked yet`);
  const good = ok && !fails;
  return el('span', { class: 'ck ' + (good ? 'ok' : 'bad'), title: lastOk ? 'Last answered ' + ago(lastOk) : 'Never answered' },
    el('i'), `${label}: ${good ? 'answers' : fails + ' failed check' + (fails === 1 ? '' : 's')} (${status || '—'}) · ${ago(at)}`);
}
function productCard(p, opts) {
  const cat = CATS[p.category] || CATS.other, card = el('article', { class: 'pc', style: '--c:' + cat[1] });
  const descEl = el('p', { class: 'desc clamp', text: p.description });
  const facts = [['For', p.audience], ['Price', (PRICING[p.pricing] || p.pricing) + (p.price_text ? ' · ' + p.price_text : '')]];
  if ((p.platforms || []).length) facts.push(['Platforms', p.platforms.map(x => PLATFORMS[x] || x).join(', ')]);
  if ((p.integrations || []).length) facts.push(['Works with', p.integrations.join(', ')]);
  facts.push(['Spot', `${p.zone} · ${p.size}×${p.size} at ${p.x},${p.y}`]);
  if (p.status === 'approved') facts.push(['Last 30 days', `${fmt(p.views_30)} views · ${fmt(p.clicks_30)} clicks · ▲ ${fmt(p.upvotes)} upvotes in all`]);
  const decide = el('div', { class: 'decide', hidden: true });
  const act = async (status, note, btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await rpc('admin_set_status', { p_slug: p.slug, p_status: status, p_note: note || '' });
      toast({ approved: `${p.name} is live.`, rejected: `${p.name} sent back to the maker.`, hidden: `${p.name} is hidden.`, removed: `${p.name} removed.` }[status] + (r.contact_email && !/\.invalid$/.test(r.contact_email) && status !== 'removed' ? ' The maker gets an email.' : ''));
      if (opts && opts.onChange) opts.onChange(r); counts();
    } catch (err) {
      toast(err.message === 'invalid:note' ? 'Write a short note for the maker first.' : 'Couldn’t save: ' + err.message, true);
      if (btn) btn.disabled = false;
    }
  };
  const ask = (status, label, cls) => {
    const ta = el('textarea', { placeholder: status === 'removed' ? 'Internal note (optional)' : 'Note to the maker — they see this in their owner panel and in the email.', maxlength: '400' });
    const send = el('button', { class: 'btn btn-sm ' + cls, text: label, onclick: () => act(status, ta.value.trim(), send) });
    fill(decide,
      el('b', { text: status === 'removed' ? 'Remove for good? The spot is freed and the maker’s email and key are wiped.' : status === 'hidden' ? 'Hide from the site' : 'Send back with changes needed' }),
      PRESETS[status] ? el('div', { class: 'presets' }, PRESETS[status].map(t => el('button', { type: 'button', text: t, onclick: () => { ta.value = t; ta.focus(); } }))) : null,
      ta, el('div', { class: 'row' }, send, el('button', { class: 'btn btn-ghost btn-sm', text: 'Cancel', onclick: () => { decide.hidden = true; } })));
    decide.hidden = false; ta.focus();
  };
  const acts = [];
  if (p.status !== 'approved') acts.push(el('button', { class: 'btn btn-ok btn-sm', text: p.status === 'pending' ? '✓ Approve' : '✓ Make live', onclick: e => act('approved', '', e.currentTarget) }));
  else if (p.open_reports) acts.push(el('button', { class: 'btn btn-ok btn-sm', text: '✓ Keep live', title: 'Reports checked, nothing wrong', onclick: e => act('approved', '', e.currentTarget) }));
  if (p.status !== 'rejected') acts.push(el('button', { class: 'btn btn-warn btn-sm', text: 'Needs changes…', onclick: () => ask('rejected', 'Send to maker', 'btn-warn') }));
  if (p.status === 'approved') acts.push(el('button', { class: 'btn btn-warn btn-sm', text: 'Hide…', onclick: () => ask('hidden', 'Hide it', 'btn-warn') }));
  acts.push(el('span', { class: 'sp' }));
  if (p.status === 'approved') acts.push(el('button', { class: 'btn btn-ghost btn-sm', text: p.spotlight_blocked ? 'Allow in Spotlight' : 'Keep out of Spotlight', title: 'The Spotlight is the 8 places in the core, earned by real use', onclick: async e => {
    const btn = e.currentTarget; btn.disabled = true;
    try { const r = await rpc('admin_spotlight_block', { p_slug: p.slug, p_blocked: !p.spotlight_blocked }); toast(r.spotlight_blocked ? `${p.name} is kept out of the Spotlight.` : `${p.name} can be in the Spotlight again.`); if (opts && opts.onChange) opts.onChange(r); }
    catch (err) { toast('Couldn’t save: ' + err.message, true); btn.disabled = false; }
  } }));
  if (p.upvotes) acts.push(el('button', { class: 'btn btn-ghost btn-sm', text: 'Reset upvotes', title: 'Takes back every upvote on this product, for vote rings and the like', onclick: async e => {
    if (!confirm(`Take back all ${p.upvotes} upvotes on ${p.name}? This can’t be undone.`)) return;
    const btn = e.currentTarget; btn.disabled = true;
    try { const r = await rpc('admin_reset_votes', { p_slug: p.slug }); toast(`Upvotes on ${p.name} reset.`); if (opts && opts.onChange) opts.onChange(r); }
    catch (err) { toast('Couldn’t reset: ' + err.message, true); btn.disabled = false; }
  } }));
  if (p.status === 'approved') acts.push(el('a', { class: 'btn btn-ghost btn-sm', href: SITE + '/p/' + p.slug, target: '_blank', rel: 'noopener', text: 'Profile ↗' }));
  acts.push(el('button', { class: 'btn btn-bad btn-sm', text: 'Remove…', onclick: () => ask('removed', 'Remove', 'btn-bad') }));
  card.append(...[
    el('div', { class: 'head' }, el('span', { class: 'name', text: p.name }), statusBadge(p.status), el('span', { class: 'badge b-cat', text: cat[0] }),
      p.verified_at ? el('span', { class: 'badge b-ver', text: '✓ Verified ' + day(p.verified_at) }) : null,
      p.spotlight_rank ? el('span', { class: 'badge b-star', text: '★ Spotlight #' + p.spotlight_rank }) : null,
      p.spotlight_blocked ? el('span', { class: 'badge b-rep', text: 'Kept out of Spotlight' }) : null,
      p.open_reports ? el('span', { class: 'badge b-rep', text: p.open_reports + ' open report' + (p.open_reports === 1 ? '' : 's') }) : null),
    el('p', { class: 'tag', text: p.tagline }),
    el('div', { class: 'meta' },
      el('a', { href: p.url, target: '_blank', rel: 'noopener nofollow', text: p.domain + ' ↗' }),
      p.demo_url ? el('a', { href: p.demo_url, target: '_blank', rel: 'noopener nofollow', text: 'demo ↗' }) : null,
      el('span', { text: 'Sent ' + ago(p.created_at) }),
      p.approved_at ? el('span', { text: 'Live since ' + day(p.approved_at) }) : null,
      p.contact_email && !/\.invalid$/.test(p.contact_email) ? el('a', { href: 'mailto:' + p.contact_email, text: p.contact_email }) : null,
      p.referred_by ? el('span', { text: 'via ' + p.referred_by }) : null),
    el('div', { class: 'needs' }, (p.needs || []).map(n => el('span', { class: 'need', text: n }))),
    descEl,
    p.description && p.description.length > 220 ? el('button', { class: 'linkbtn', style: 'margin-top:4px', text: 'Show all', onclick: e => { descEl.classList.toggle('clamp'); e.target.textContent = descEl.classList.contains('clamp') ? 'Show all' : 'Show less'; } }) : null,
    (p.images || []).length ? el('div', { class: 'imgs' }, p.images.map(src => el('a', { href: src, target: '_blank', rel: 'noopener nofollow' }, el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: e => { e.target.replaceWith(el('span', { class: 'ck bad' }, el('i'), 'image doesn’t load')); } })))) : null,
    el('div', { class: 'grid2' }, facts.map(f => el('div', { class: 'fact' }, el('small', { text: f[0] }), el('span', { text: f[1] })))),
    el('div', { class: 'checks' },
      check('Website', p.site_ok_at || !p.site_fails, p.site_status, p.site_checked_at, p.site_fails, p.site_last_ok_at),
      p.demo_url ? check('Demo', !p.demo_fails, p.demo_status, p.demo_checked_at, p.demo_fails, p.demo_last_ok_at) : null),
    p.review_note && p.status !== 'approved' ? el('div', { class: 'note' }, el('b', { text: 'Note to maker: ' }), p.review_note) : null,
    opts && opts.reports && opts.reports.length ? el('div', { class: 'reps' }, opts.reports.map(r => el('div', { class: 'rep' }, el('b', { text: (r.automatic ? 'Automatic: ' : '') + (REASONS[r.reason] || r.reason) }), r.details ? ' — ' + r.details : '', ` · ${ago(r.created_at)}`))) : null,
    decide,
    el('div', { class: 'acts' }, acts)].filter(Boolean));
  return card;
}

/* ---------- tabs ---------- */
async function renderQueue(main) {
  const [list, reps] = await Promise.all([rpc('admin_products', { p_filter: 'queue' }), rpc('admin_reports')]);
  if (tab !== 'queue') return;
  const byProduct = {}; for (const r of reps) if (!r.resolved) (byProduct[r.slug] = byProduct[r.slug] || []).push(r);
  const pending = list.filter(p => p.status === 'pending'), other = list.filter(p => p.status !== 'pending');
  const box = el('div', { class: 'list' });
  const paint = () => {
    box.replaceChildren(...[...pending, ...other].map(p => productCard(p, { reports: byProduct[p.slug], onChange: () => go('queue') })));
    if (!pending.length && !other.length) box.replaceChildren(el('div', { class: 'empty' }, el('b', { text: 'Nothing to review.' }), 'New products and reported or broken listings show up here. You can also get an email when something arrives — see Settings.'));
  };
  paint();
  fill(main,
    el('h2', { class: 'h', text: 'To review' }),
    el('p', { class: 'sub', text: `${pending.length} new product${pending.length === 1 ? '' : 's'} waiting${other.length ? ` · ${other.length} live listing${other.length === 1 ? '' : 's'} reported or not answering` : ''}. Approving puts a product on the map at once and emails the maker.` }),
    box);
}

async function renderReports(main) {
  const reps = await rpc('admin_reports');
  if (tab !== 'reports') return;
  const open = reps.filter(r => !r.resolved), done = reps.filter(r => r.resolved);
  const row = r => el('div', { class: 'rrow' + (r.resolved ? ' done' : '') },
    el('div', null,
      el('div', { class: 't', text: `${r.name} — ${REASONS[r.reason] || r.reason}` }),
      r.details ? el('div', { class: 'd', text: r.details }) : null,
      el('div', { class: 'm', text: `${r.automatic ? 'Automatic check' : 'Anonymous visitor'} · ${ago(r.created_at)} · product is ${STATUS[r.status] || r.status}` })),
    el('div', { class: 'a' },
      el('a', { class: 'btn btn-ghost btn-sm', href: r.url, target: '_blank', rel: 'noopener nofollow', text: 'Check site ↗' }),
      !r.resolved && r.status === 'approved' ? el('button', { class: 'btn btn-warn btn-sm', text: 'Review product', title: 'Open it under To review to keep it live or hide it', onclick: () => go('queue') }) : null,
      el('button', { class: 'btn btn-sm ' + (r.resolved ? 'btn-ghost' : 'btn-ok'), text: r.resolved ? 'Reopen' : '✓ Handled', onclick: async e => {
        const btn = e.currentTarget; btn.disabled = true;
        try { await rpc('admin_resolve_report', { p_id: r.id, p_resolved: !r.resolved }); toast(r.resolved ? 'Report reopened.' : 'Marked as handled.'); go('reports'); counts(); }
        catch (err) { toast('Couldn’t save: ' + err.message, true); btn.disabled = false; }
      } })));
  fill(main,
    el('h2', { class: 'h', text: 'Reports' }),
    el('p', { class: 'sub', text: 'From visitors (“Report a problem” on a profile) and from the daily website check. To hide a reported product, open it under To review.' }),
    open.length ? el('div', { class: 'list' }, open.map(row)) : el('div', { class: 'empty' }, el('b', { text: 'No open reports.' }), 'Nice and quiet.'),
    done.length ? el('h3', { style: 'margin-top:30px;font-size:17px;color:var(--muted)', text: 'Handled in the last 30 days' }) : null,
    done.length ? el('div', { class: 'list' }, done.map(row)) : null);
}

/* ---------- placements (Sponsored slots) ---------- */
const PSTATE = { requested: 'Requested', awaiting_payment: 'Waiting for payment', expired: 'Not paid in time', upcoming: 'Paid · starts soon', live: 'Running', ended: 'Ended', rejected: 'Declined', cancelled: 'Withdrawn' };
const eur = n => '€' + Number(n).toLocaleString('en', { maximumFractionDigits: 2 });
const isoDay = d => d.toISOString().slice(0, 10);
async function renderPlacements(main) {
  const [list, s] = await Promise.all([rpc('admin_placements'), rpc('admin_settings')]);
  if (tab !== 'placements') return;
  const open = list.filter(x => ['requested', 'awaiting_payment', 'upcoming', 'live'].includes(x.state)), done = list.filter(x => !open.includes(x));
  fill(main,
    el('h2', { class: 'h', text: 'Placements' }),
    el('p', { class: 'sub', text: 'Sponsored slots makers asked for. Schedule one with dates and a price (and a payment link if you have one, like a Stripe Payment Link) — the maker gets an email. Mark it paid when the money is in: only paid slots show on the site, in at most two cards marked “Sponsored” where they fit the search. They never change the ranking. A year is 52 weeks.' }),
    open.length ? el('div', { class: 'list' }, open.map(x => placementCard(x, s.placement_price_eur))) : el('div', { class: 'empty' }, el('b', { text: 'No open requests.' }), s.placement_price_eur != null ? `Makers see ${eur(s.placement_price_eur)} for a year (Settings).` : 'Makers see “we confirm the price with you”. Set a yearly price under Settings.'),
    done.length ? el('h3', { style: 'margin-top:30px;font-size:17px;color:var(--muted)', text: 'Earlier' }) : null,
    done.length ? el('div', { class: 'list' }, done.map(x => placementCard(x, s.placement_price_eur))) : null);
}
const weeksLabel = w => w === 52 ? '1 year' : w + (w === 1 ? ' week' : ' weeks');
function placementCard(x, yearPrice) {
  const cat = CATS[x.category] || CATS.other;
  const act = async (btn, action, p, ok) => {
    btn.disabled = true;
    try { await rpc('admin_placement_action', { p_id: x.id, p_action: action, p: p || {} }); toast(ok); go('placements'); counts(); }
    catch (err) {
      const m = err.message;
      toast(m === 'invalid:start' ? 'Pick a start date from today.' : m === 'invalid:price' ? 'Enter a price (0 or more).' : m === 'invalid:pay_url' ? 'The payment link must be an https:// link.' : m === 'invalid:note' ? 'Write a short note for the maker.' : m === 'invalid:dates' ? 'The dates have passed — schedule it again first.' : 'Couldn’t save: ' + m, true);
      btn.disabled = false;
    }
  };
  const card = el('article', { class: 'pc', style: '--c:' + cat[1] });
  const head = el('div', { class: 'head' }, el('a', { class: 'name', href: SITE + '/p/' + x.slug, target: '_blank', rel: 'noopener', text: x.name }), el('span', { class: 'badge st-' + (x.state === 'rejected' ? 'rejected-p' : x.state), text: PSTATE[x.state] || x.state }));
  const lines = [
    `Asked for ${weeksLabel(x.weeks)}, ${x.wish_start ? 'from ' + day(x.wish_start) : 'as soon as possible'} · ${ago(x.created_at)} · ${x.contact_email || '—'}`,
    x.start_date ? `Scheduled ${day(x.start_date)} – ${day(x.end_date)}${x.price_eur != null ? ' · ' + eur(x.price_eur) : ''}${x.paid_at ? ' · paid ' + day(x.paid_at) : ' · not paid'}${x.stopped_at ? ' · stopped ' + day(x.stopped_at) : ''}` : null,
    x.pay_url ? 'Payment link: ' + x.pay_url : null].filter(Boolean);
  card.append(head, ...lines.map(t => el('p', { class: 'sub', style: 'margin-top:6px;overflow-wrap:anywhere', text: t })));
  if (x.owner_note) card.append(el('div', { class: 'note', text: '“' + x.owner_note + '”' }));
  if (x.admin_note && x.state !== 'requested') card.append(el('p', { class: 'sub', style: 'margin-top:6px', text: 'Your note: ' + x.admin_note }));
  if (x.report) {
    const r = x.report, pct = (a, b) => b ? ` (${a >= b ? '+' : ''}${Math.round((a - b) / b * 100)}%)` : '';
    card.append(el('div', { class: 'prep' },
      el('span', null, el('b', { text: fmt(r.impressions) }), ' shown'), el('span', null, el('b', { text: fmt(r.clicks) }), r.clicks === 1 ? ' click' : ' clicks'),
      el('span', null, el('b', { text: fmt(r.views) }), ` profile views vs ${fmt(r.before.views)} before${pct(r.views, r.before.views)}`),
      el('span', null, el('b', { text: fmt(r.site_clicks) }), ` site clicks vs ${fmt(r.before.site_clicks)} before${pct(r.site_clicks, r.before.site_clicks)}`),
      el('span', { text: r.cmp_days && r.cmp_days < r.days ? `shown/clicked over ${r.days} days · views and site clicks: first ${r.cmp_days} days` : `over ${r.days} day${r.days === 1 ? '' : 's'}` })));
  }
  if (['requested', 'awaiting_payment', 'expired'].includes(x.state)) {
    const today = isoDay(new Date()), wish = x.wish_start && x.wish_start >= today ? x.wish_start : today;
    const start = el('input', { type: 'date', min: today }); start.value = x.start_date && x.start_date >= today ? x.start_date : wish;
    const weeks = el('input', { type: 'number', min: '1', max: '52', step: '1', title: '52 weeks = a year' }); weeks.value = x.weeks;
    const price = el('input', { type: 'number', min: '0', step: '1', placeholder: '€' });
    price.value = x.price_eur != null ? x.price_eur : yearPrice != null ? Math.round(yearPrice * Math.min(x.weeks, 52) / 52 * 100) / 100 : '';
    const link = el('input', { type: 'url', placeholder: 'https://buy.stripe.com/… (optional)' }); link.value = x.pay_url || '';
    const note = el('textarea', { placeholder: 'Note for the maker (needed to decline)' });
    card.append(el('div', { class: 'sched' },
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Start' }), start),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Weeks (52 = a year)' }), weeks),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Price in total (€)' }), price)),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Payment link' }), link),
      el('div', { class: 'decide' }, note),
      el('div', { class: 'bar' },
        el('button', { class: 'btn btn-ok btn-sm', text: x.state === 'requested' ? 'Schedule & email maker' : 'Reschedule & email maker', onclick: e => act(e.currentTarget, 'schedule', { start: start.value, weeks: +weeks.value, price_eur: price.value === '' ? null : +price.value, pay_url: link.value.trim(), note: note.value }, 'Scheduled. The maker gets an email.') }),
        x.state !== 'requested' ? el('button', { class: 'btn btn-primary btn-sm', text: '✓ Mark paid', onclick: e => { if (confirm(`Mark ${x.name}'s slot as paid? It goes live on ${day(x.start_date)}.`)) act(e.currentTarget, 'paid', {}, 'Marked paid. The maker gets a confirmation.'); } }) : null,
        el('button', { class: 'btn btn-warn btn-sm', text: 'Decline', onclick: e => act(e.currentTarget, 'reject', { note: note.value }, 'Declined. The maker gets an email with your note.') })));
  }
  if (['upcoming', 'live'].includes(x.state)) {
    card.append(el('div', { class: 'bar' }, el('button', { class: 'btn btn-warn btn-sm', text: 'Stop now', onclick: e => { if (confirm(`Stop ${x.name}'s Sponsored slot now? Sort out any refund with the maker yourself.`)) act(e.currentTarget, 'stop', {}, 'Stopped.'); } })));
  }
  return card;
}

let pFilter = 'all', pQuery = '';
async function renderProducts(main) {
  const list = await rpc('admin_products', { p_filter: pFilter });
  if (tab !== 'products') return;
  const box = el('div', { class: 'list' });
  const paint = () => {
    const q = pQuery.toLowerCase();
    const rows = list.filter(p => !q || (p.name + ' ' + p.domain + ' ' + p.slug + ' ' + (p.contact_email || '')).toLowerCase().includes(q));
    box.replaceChildren(...rows.map(p => productCard(p, { onChange: () => go('products') })));
    if (!rows.length) box.replaceChildren(el('div', { class: 'empty' }, el('b', { text: 'No products here.' }), list.length ? 'Try another search.' : 'Nothing with this status yet.'));
  };
  const search = el('input', { type: 'search', placeholder: 'Search name, domain or email', value: pQuery });
  search.value = pQuery;
  search.addEventListener('input', () => { pQuery = search.value; paint(); });
  fill(main,
    el('h2', { class: 'h', text: 'Products' }),
    el('div', { class: 'bar' },
      [['all', 'All'], ['approved', 'Live'], ['pending', 'In review'], ['rejected', 'Changes needed'], ['hidden', 'Hidden'], ['removed', 'Removed']].map(([k, l]) =>
        el('button', { class: 'chip', 'aria-pressed': String(pFilter === k), text: l, onclick: () => { pFilter = k; go('products'); } })),
      search),
    box);
  paint();
}

async function renderOverview(main) {
  const o = await counts();
  if (!o || tab !== 'overview') { if (!o) throw new Error('Couldn’t load the overview.'); return; }
  const c = o.counts, days = o.days || [], max = Math.max(1, ...days.map(d => Math.max(d.view, d.click)));
  const sum = k => days.reduce((a, d) => a + (d[k] || 0), 0);
  const w = o.worker || {};
  fill(main,
    el('h2', { class: 'h', text: 'Overview' }),
    el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('b', { text: fmt(c.approved) }), el('small', { text: 'products live' })),
      el('div', { class: 'kpi' + (c.pending ? ' warn' : '') }, el('b', { text: fmt(c.pending) }), el('small', { text: 'waiting for review' })),
      el('div', { class: 'kpi' + (o.open_reports ? ' warn' : '') }, el('b', { text: fmt(o.open_reports) }), el('small', { text: 'open reports' })),
      el('div', { class: 'kpi' }, el('b', { text: fmt(sum('view')) }), el('small', { text: 'profile views · 30 days' })),
      el('div', { class: 'kpi' }, el('b', { text: fmt(sum('click')) }), el('small', { text: 'clicks to sites · 30 days' })),
      el('div', { class: 'kpi' }, el('b', { text: fmt(c.verified) }), el('small', { text: 'live with verified domain' })),
      el('div', { class: 'kpi' + (o.placements && o.placements.requested ? ' warn' : '') }, el('b', { text: fmt(o.placements ? o.placements.live : 0) }), el('small', { text: `sponsored slots running${o.placements && o.placements.requested ? ` · ${o.placements.requested} requested` : ''}` }))),
    el('div', { class: 'panel' }, el('h3', { text: 'Last 30 days' }),
      el('div', { class: 'chart', role: 'img', 'aria-label': `${sum('view')} profile views and ${sum('click')} clicks in the last 30 days` },
        days.map(d => el('div', { class: 'd', title: `${d.d}: ${d.view} views, ${d.click} clicks` }, el('div', { class: 'v', style: `height:${d.view / max * 100}%` }), el('div', { class: 'c', style: `height:${d.click / max * 100}%` })))),
      el('div', { class: 'legend' }, el('span', null, el('i', { style: 'background:rgba(94,225,255,.55)' }), 'Profile views (unique per day)'), el('span', null, el('i', { style: 'background:var(--lime)' }), 'Clicks to website or demo'))),
    el('div', { class: 'panel' }, el('h3', { text: 'Most viewed · 30 days' }),
      (o.top || []).length ? el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Product' }), el('th', { class: 'n', text: 'Views' }), el('th', { class: 'n', text: 'Clicks' }))),
        el('tbody', null, o.top.map(t => el('tr', null, el('td', null, el('a', { href: SITE + '/p/' + t.slug, target: '_blank', rel: 'noopener', text: t.name })), el('td', { class: 'n', text: fmt(t.views) }), el('td', { class: 'n', text: fmt(t.clicks) })))))
        : el('p', { class: 'sub', text: 'No visits yet.' })),
    el('div', { class: 'panel' }, el('h3', { text: 'System' }),
      el('div', { class: 'sys' },
        el('span', { text: `Background jobs last ran ${w.at ? ago(w.at) : '—'}${w.health && w.health.checked != null ? ` · checked ${w.health.checked} site${w.health.checked === 1 ? '' : 's'}` : ''}${w.mail && w.mail.sent != null ? ` · sent ${w.mail.sent} email${w.mail.sent === 1 ? '' : 's'}` : ''}.` }),
        el('span', { text: `Emails: ${fmt(o.outbox.sent_7d)} sent in 7 days · ${fmt(o.outbox.pending)} waiting · ${fmt(o.outbox.failed)} failed.` }),
        el('span', { text: `Products: ${fmt(c.approved)} live · ${fmt(c.pending)} in review · ${fmt(c.rejected)} changes needed · ${fmt(c.hidden)} hidden · ${fmt(c.removed)} removed · ${fmt(c.failing)} live sites not answering. Founding reservations: ${fmt(o.reservations)}.` }))));
}

/* Email goes out through Resend. The key is saved straight into Supabase Vault and can't be read back. */
function emailPanel(e) {
  const key = el('input', { type: 'password', placeholder: 're_…', autocomplete: 'off', spellcheck: 'false' });
  const state = e.connected
    ? `Connected. ${e.last_sent_at ? 'Last email sent ' + ago(e.last_sent_at) + '.' : 'No email sent yet.'}${e.waiting ? ` ${e.waiting} waiting.` : ''}`
    : 'Not connected yet — review emails and sign-in codes wait until a key is added.';
  return el('div', { class: 'panel' }, el('h3', { text: 'Email sending' }),
    el('p', { class: 'sub', text: state }),
    e.paused_until ? el('div', { class: 'note' }, el('b', { text: 'Daily email limit reached. ' }), `Your Resend plan's quota is used up, so emails wait until ${new Date(e.paused_until).toLocaleString('en', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} and email sign-in is paused (makers can still use their owner key). Upgraded your plan? `,
      el('button', { class: 'linkbtn', text: 'Resume now', onclick: async ev => { ev.currentTarget.disabled = true; try { await rpc('admin_save_settings', { p: { resume_email: true } }); toast('Resumed. Waiting emails go out within a minute.'); go('settings'); } catch (err) { toast('Couldn’t resume: ' + err.message, true); } } })) : null,
    e.last_error ? el('div', { class: 'note', text: 'Last problem: ' + e.last_error }) : null,
    el('p', { class: 'fine', text: 'Review decisions, sign-in codes and your digest go out from expanse@nyttolabs.com through Resend. Without a key, makers can’t sign in with email. In Resend: API Keys → Create API key → permission “Sending access”, domain nyttolabs.com. Paste it here. It is stored encrypted in Supabase Vault and can’t be shown again.' }),
    el('label', { class: 'field' }, el('span', { class: 'mono', text: e.connected ? 'Replace the Resend API key' : 'Resend API key' }), key),
    el('div', { class: 'bar' }, el('button', { class: 'btn btn-primary btn-sm', text: 'Save key', onclick: async ev => {
      const btn = ev.currentTarget; btn.disabled = true;
      try { await rpc('admin_save_settings', { p: { resend_api_key: key.value.trim() } }); key.value = ''; toast('Saved. Waiting emails go out within a minute.'); setTimeout(() => go('settings'), 4000); }
      catch (err) { toast(err.message === 'invalid:resend_api_key' ? 'That doesn’t look like a Resend key (it starts with re_).' : 'Couldn’t save: ' + err.message, true); }
      finally { btn.disabled = false; }
    } })));
}

function pricePanel(s) {
  const price = el('input', { type: 'number', min: '0', step: '1', placeholder: 'e.g. 19' }); price.value = s.placement_price_eur != null ? s.placement_price_eur : '';
  return el('div', { class: 'panel' }, el('h3', { text: 'Sponsored slot price' }),
    el('p', { class: 'sub', text: 'The price for a year that makers see under Promote. Leave empty to show “we confirm the price with you”. You still set the final price on each request.' }),
    el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Euro per year' }), price),
    el('div', { class: 'bar' }, el('button', { class: 'btn btn-primary btn-sm', text: 'Save', onclick: async e => {
      const btn = e.currentTarget; btn.disabled = true;
      try { const r = await rpc('admin_save_settings', { p: { placement_price_eur: price.value.trim() } }); price.value = r.placement_price_eur != null ? r.placement_price_eur : ''; toast(r.placement_price_eur != null ? `Saved: ${eur(r.placement_price_eur)} per year.` : 'Saved. Makers see “we confirm the price with you”.'); }
      catch (err) { toast(err.message === 'invalid:placement_price_eur' ? 'Enter a number, or leave it empty.' : 'Couldn’t save: ' + err.message, true); }
      finally { btn.disabled = false; }
    } })));
}
async function renderSettings(main) {
  const [s,seller] = await Promise.all([rpc('admin_settings'),rpc('admin_seller')]);
  if (tab !== 'settings') return;
  const mail = el('input', { type: 'email', placeholder: 'you@example.com', value: s.notify_email || '' });
  mail.value = s.notify_email || '';
  const keyOut = el('div');
  main.replaceChildren(el('div', { class: 'set' },
    el('h2', { class: 'h', text: 'Settings' }),
    el('div', { class: 'panel' }, el('h3', { text: 'Email me when something needs review' }),
      el('p', { class: 'sub', text: 'At most one short email every 10 minutes, when new products are waiting or new reports come in. Leave empty to turn it off. The address is stored in the Expanse database only for this.' }),
      el('label', { class: 'field' }, el('span', { class: 'mono', text: 'Your email' }), mail),
      el('div', { class: 'bar' }, el('button', { class: 'btn btn-primary btn-sm', text: 'Save', onclick: async e => {
        const btn = e.currentTarget; btn.disabled = true;
        try { const r = await rpc('admin_save_settings', { p: { notify_email: mail.value.trim() } }); mail.value = r.notify_email; toast(r.notify_email ? 'Saved. You’ll get an email when something arrives.' : 'Saved. Notifications are off.'); }
        catch (err) { toast(err.message === 'invalid:notify_email' ? 'That email looks off.' : 'Couldn’t save: ' + err.message, true); }
        finally { btn.disabled = false; }
      } }))),
    sellerPanel(seller),
    emailPanel(s.email || {}),
    pricePanel(s),
    el('div', { class: 'panel' }, el('h3', { text: 'Admin key' }),
      el('p', { class: 'sub', text: `Make a new key and stop the current one from working. Do this if the key may have been seen by someone else. Active keys: ${s.keys}.` }),
      el('div', { class: 'bar' }, el('button', { class: 'btn btn-warn btn-sm', text: 'Make a new key', onclick: async e => {
        if (!confirm('Make a new admin key? The key you used to sign in stops working right away.')) return;
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const k = await rpc('admin_rotate_key'); KEY = k; store.set(k, (() => { try { return !!localStorage.getItem(KEY_STORE); } catch (x) { return false; } })());
          keyOut.replaceChildren(el('div', { class: 'keybox' }, el('b', { text: 'Your new admin key — save it in your password manager now.' }), el('code', { text: k }),
            el('div', { class: 'bar' }, el('button', { class: 'btn btn-ghost btn-sm', text: 'Copy', onclick: async () => { try { await navigator.clipboard.writeText(k); toast('Copied.'); } catch (x) { toast('Select the key and copy it.', true); } } }))));
        } catch (err) { toast('Couldn’t make a new key: ' + err.message, true); btn.disabled = false; }
      } })), keyOut),
    el('div', { class: 'panel' }, el('h3', { text: 'How review works' }),
      el('div', { class: 'sys' },
        el('span', { text: 'Approve: the product goes live on the map and in search at once, and the maker gets an email.' }),
        el('span', { text: 'Needs changes: the maker sees your note in their owner panel and in an email. When they save an edit, it comes back here.' }),
        el('span', { text: 'Hide: a live product disappears from the site until you make it live again. Use it for reports you need to check.' }),
        el('span', { text: 'Remove: for spam. The spot is freed and the maker’s email and owner key are wiped.' }),
        el('span', { text: 'Every day each website and demo link is checked. A live site that doesn’t answer three days in a row shows up here as an automatic report.' })))));
}

if (KEY) {
  rpc('admin_settings').then(start).catch(err => { if (err.message !== 'bad_admin') { start(); } });
} else showLogin();
/* Needs stay private until consent and explicit anonymization review. */
async function renderToolNeeds(main){
 const rows=await rpc('admin_tool_needs');
 main.replaceChildren(el('h2',{text:'Needs pilot · review before sharing'}),el('p',{class:'fine',text:'Only consented requests enter this queue. Remove names, organizations that identify the requester, contact details and confidential details. Do not invent demand or strengthen a request. No email or outreach is sent.'}));
 if(!rows.length){main.append(el('p',{class:'empty',text:'No consented needs awaiting review or published.'}));return;}
 for(const n of rows){
  const text=el('textarea',{rows:4,maxlength:600,'aria-label':'Anonymized public need'});text.value=n.public_text||n.raw_text;
  const ack=el('input',{type:'checkbox','aria-label':'I checked this text is anonymized'}),status=el('p',{class:'fine',role:'status'});
  const card=el('section',{class:'card'},el('h3',{text:n.state==='pending'?'Awaiting review':'Published · can be revised or withdrawn'}),el('p',{class:'fine',text:'Private original (never public):'}),el('p',{text:n.raw_text}),el('label',{class:'field'},el('span',{text:'Public version'}),text),el('label',{style:'display:flex;gap:10px;margin:14px 0'},ack,el('span',{text:'I reviewed and anonymized this version, including names and contact details.'})),status);
  const act=async approve=>{if(approve&&!ack.checked){status.textContent='Confirm the anonymization review before publishing.';return;}try{await rpc('admin_review_tool_need',{p_id:n.id,p_approve:approve,p_text:text.value.replace(/\s+/g,' ').trim(),p_anonymized:ack.checked});go('needs');}catch{status.textContent='Could not save. Public text must be 18–600 characters, with no links or contact details; the request must still have consent.';}};
  card.append(el('div',{class:'actions'},el('button',{class:'btn primary',text:'Publish anonymized need',onclick:()=>act(true)}),el('button',{class:'btn',text:'Keep private / remove from board',onclick:()=>act(false)})));main.append(card);
 }
}


})();
