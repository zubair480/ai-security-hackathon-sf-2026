/* PayeeLock investigation workbench. Existing events and ledger remain authoritative. */
const $ = (s, root=document) => root.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const money = n => "$"+Number(n ?? 0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const mask = n => n ? "••••"+String(n).replace(/\D/g,"").slice(-4) : "—";
const bank = b => b && (b.routing || b.account) ? (b.routing ?? "?")+" / "+(b.account ?? "?") : "account on file";
const hhmm = d => new Date(d).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit"});
const ms = n => n==null ? "—" : n<1000 ? Math.round(n)+" ms" : (n/1000).toFixed(1)+" s";
const STAMP={EXECUTED:"Executed",BLOCKED:"Blocked",PENDING_APPROVAL:"Held for review",NO_ACTION:"No action",ERROR:"Run failed",RUNNING:"Processing"};
const RUNBOOK=["legit","attack","bankchange","pay0913"];
const SCENARIO_UI={
  legit:{title:"Legitimate invoice",meta:"Baseline · $48,250",description:"Pay the first Northwind invoice using the account on file."},
  attack:{title:"Payment diversion",meta:"Look-alike sender · $51,900",description:"The email supplies new bank details and a Python confirmation script. Inspect the agent proposal against the approved payee."},
  bankchange:{title:"Legitimate bank change",meta:"Approved sender · callback required",description:"A genuine vendor request is held for independent verification. Resolve the suspicious request and record the legitimate callback."},
  pay0913:{title:"Payment after verification",meta:"Approved account · $51,900",description:"After resolving every pending bank change, pay the invoice to the approved account."}
};
const state={ledger:null,inboxes:{},scenarios:{},sandbox:null,agentMode:"",mailStatus:"unknown",connected:false,
  cases:new Map(),order:[],sent:new Map(),activeCase:null,selected:0,query:"",view:"investigation",evidenceTab:"email",detailTab:"script",diagnosticsOpen:false,
  showResolved:false,busy:null,modal:null,source:null,syncing:false,queued:[]};
function replaceHTML(sel,html) {
  const el=$(sel), active=document.activeElement;
  const focus=el.contains(active) ? active.dataset.focus : null;
  if (el.innerHTML===html) return;
  const scrolls=[...el.querySelectorAll("[data-scroll]")].map(x=>[x.dataset.scroll,x.scrollTop]);
  el.innerHTML=html;
  for (const [key,y] of scrolls) [...el.querySelectorAll("[data-scroll]")].find(x=>x.dataset.scroll===key)?.scrollTo(0,y);
  if (focus) [...el.querySelectorAll("[data-focus]")].find(x=>x.dataset.focus===focus)?.focus({preventScroll:true});
}
function connectionWarning(message) {
  const el=$("#connection-alert"); el.hidden=!message;
  el.innerHTML=message ? esc(message)+' <button data-retry>Reconnect</button>' : "";
}
async function readState() {
  const r=await fetch("/api/state",{cache:"no-store"}); if(!r.ok) throw new Error("Workspace returned "+r.status); return r.json();
}
function caseFor(id) {
  let c=state.cases.get(id);
  if(!c) { c={id,n:state.cases.size+1,at:{},decisions:[]};state.cases.set(id,c);state.order.unshift(id); }
  return c;
}
function outcomeOf(c) {
  for(const status of ["BLOCKED","PENDING_APPROVAL","EXECUTED"]) if(c.decisions.some(d=>d.status===status)) return status;
  return c.decisions.length ? "NO_ACTION" : c.error ? "ERROR" : "RUNNING";
}
function isRunning() {return [...state.cases.values()].some(c=>outcomeOf(c)==="RUNNING");}
function applyEvent(ev,replay=false) {
  const d=ev.data;
  switch(ev.type) {
    case "system.mail":state.mailStatus=d.status;break;
    case "email.sent":state.sent.set(d.scenario,ev.at);break;
    case "email.received": {
      const fresh=!state.cases.has(d.messageId),c=caseFor(d.messageId);c.email=d;c.at.received=ev.at;
      if(!replay&&fresh){state.activeCase=c.id;state.view="investigation";state.query="";$("#case-search").value="";state.evidenceTab="email";state.diagnosticsOpen=false;}
      break;
    }
    case "agent.code": {const c=caseFor(d.messageId);c.code=d.code;c.mode=d.mode;c.at.code=ev.at;break;}
    case "sandbox.result": {const c=caseFor(d.messageId);c.sandbox=d;c.at.sandbox=ev.at;break;}
    case "agent.proposal": {const c=caseFor(d.messageId);c.proposals=d.proposals;c.at.proposal=ev.at;break;}
    case "ledger.decision": {
      const id=d.proposal?.source?.messageId;if(!id)break;const c=caseFor(id);
      if(!c.decisions.some(x=>x.id===d.id))c.decisions.push(d);c.at.decision=ev.at;break;
    }
    case "email.replied": {const c=caseFor(d.messageId);c.reply=d;c.at.reply=ev.at;break;}
    case "pipeline.error":caseFor(d.messageId).error=d.error;break;
    case "ledger.state":state.ledger=d;break;
    case "ledger.reset":state.cases.clear();state.order=[];state.sent.clear();state.activeCase=null;state.selected=0;break;
    case "ledger.change":if(!replay)toast(d.status==="approved"?"Callback attestation recorded":"Bank change rejected",d.vendorName);break;
  }
}
function hydrate(s,initial=false) {
  const active=state.activeCase;state.cases.clear();state.order=[];state.sent.clear();
  Object.assign(state,{inboxes:s.inboxes,scenarios:s.scenarios,sandbox:s.sandbox,agentMode:s.agentMode,mailStatus:s.mailStatus??"unknown"});
  for(const ev of s.events)applyEvent(ev,true);
  state.ledger=s.ledger;
  state.activeCase=state.cases.has(active)?active:state.order[0]??null;
  if(initial&&state.activeCase){const c=state.cases.get(state.activeCase);const i=RUNBOOK.findIndex(k=>state.scenarios[k]?.subject===c.email?.subject);if(i>=0)state.selected=i;}
}
async function syncState(initial=false) {
  if(state.syncing)return;state.syncing=true;state.queued=[];
  try{hydrate(await readState(),initial);for(const ev of state.queued)applyEvent(ev);connectionWarning("");renderAll();}
  finally{state.syncing=false;state.queued=[];}
}
async function boot() {
  state.source?.close();
  try {
    await syncState(!state.ledger);
    const es=new EventSource("/api/events");state.source=es;
    es.onopen=async()=>{state.connected=true;renderAll();try{await syncState();}catch{connectionWarning("Records could not be refreshed. Reconnect to update this view.");}};
    es.onmessage=m=>{try{
      const ev=JSON.parse(m.data);
      if(ev.type==="hello"){state.mailStatus=ev.data.mailStatus??state.mailStatus;renderStatus();return;}
      if(state.syncing){state.queued.push(ev);return;}applyEvent(ev);renderAll();
    }catch{connectionWarning("An event could not be read. Reconnect to refresh the case.");}};
    es.onerror=()=>{state.connected=false;renderAll();connectionWarning("Connection interrupted. Retrying automatically; displayed records may be out of date.");};
  }catch(err){
    state.connected=false;renderStatus();connectionWarning("Workspace unavailable. Check the local server.");
    if(!state.ledger)$("#investigation").innerHTML='<div class="initial-state"><span class="eyebrow">CONNECTION UNAVAILABLE</span><h1>The workspace is offline.</h1><p>'+esc(err.message)+'</p><button class="button" data-retry>Try again</button></div>';
  }
}
function renderStatus() {
  $("#st-mail").textContent=!state.connected?"Reconnecting":state.mailStatus==="connected"?"Mail connected":state.mailStatus==="error"||state.mailStatus==="disconnected"?"Mail unavailable":"Local prototype";
  $("#dot-mail").className="dot "+(!state.connected?"warn":state.mailStatus==="connected"?"on":"");
  $("#stream-label").textContent=state.connected?"Event stream connected":"Event stream reconnecting";
  $("#stream-dot").className="dot "+(state.connected?"on":"warn");
  $("#st-agent").textContent=(isRunning()?"Processing · ":"")+(state.agentMode==="scripted"?"Scripted agent":"Claude configured") +" · simulated payments";
  $("#st-agent").title="Configured Claude steps may fall back to scripted execution.";
  $("#btn-reset").disabled=!!state.busy||isRunning()||!state.connected;
}
function renderView() {
  $("#investigation-view").hidden=state.view!=="investigation";$("#register-view").hidden=state.view!=="register";
  document.querySelectorAll("[data-view]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.view===state.view)));
}
function renderAll(){renderIncidents();renderInvestigation();renderLedger();renderApprovals();renderRunbook();renderStatus();renderView();}
function modelFor(c) {
  const payment=c.decisions.find(d=>d.proposal.type==="PAY");
  const decision=payment??c.decisions[0];
  const proposal=payment?.proposal??c.proposals?.find(p=>p.type==="PAY")??decision?.proposal??c.proposals?.[0];
  const invoiceId=proposal?.invoiceId??c.sandbox?.extraction?.invoice_id??c.email?.text?.match(/INV-\d{4}-\d{4}/)?.[0];
  const invoice=state.ledger?.invoices.find(x=>x.id===invoiceId);
  const change=state.ledger?.pendingChanges.find(x=>x.source?.messageId===c.id);
  const vendor=state.ledger?.vendors.find(x=>x.id===(invoice?.vendorId??change?.vendorId))??state.ledger?.vendors.find(v=>proposal?.vendorName&&v.name.toLowerCase().includes(proposal.vendorName.toLowerCase().split(" ")[0]));
  const bankCheck=decision?.checks?.find(x=>x.name==="destination equals approved account on file");
  const historical=bankCheck?.detail?.match(/approved routing (\d+) \/ acct ([\d-]+)/);
  const executed=state.ledger?.payments.find(p=>p.decisionId===payment?.id);
  const approved=historical?{routing:historical[1],account:historical[2]}:executed?.bank??change?.currentBank??vendor?.bank;
  const referenceCaptured=!!(historical||executed||change);
  const extracted=c.sandbox?.extraction;
  const proposed=proposal?.bank??(extracted?.bank_routing?{routing:extracted.bank_routing,account:extracted.bank_account}:null);
  const onFile=!!proposal&&!proposed&&proposal.type==="PAY";
  const status=outcomeOf(c);
  const senderCheck=decision?.checks?.find(x=>x.name==="sender on vendor contact list");
  const amountCheck=decision?.checks?.find(x=>x.name==="amount matches invoice");
  return {c,payment,decision,proposal,invoice,invoiceId,change,vendor,approved,proposed,onFile,bankCheck,senderCheck,amountCheck,status,referenceCaptured,
    amount:proposal?.type==="CHANGE_BANK"?null:proposal?.amount??extracted?.amount??invoice?.amount,
    vendorName:vendor?.name??proposal?.vendorName??"Supplier request"};
}
function renderIncidents() {
  $("#case-count").textContent=String(state.order.length).padStart(2,"0");
  const cases=state.order.map(id=>state.cases.get(id)).filter(c=>!state.query||JSON.stringify([c.email?.subject,c.email?.from]).toLowerCase().includes(state.query));
  replaceHTML("#incident-list",cases.length?cases.map(c=>{
    const m=modelFor(c),label=m.status==="BLOCKED"?"Remittance diversion":m.proposal?.type==="CHANGE_BANK"?"Bank change request":m.status==="EXECUTED"?"Invoice payment":c.error?"Processing failed":"Payment request";
    return '<button class="incident-item" data-case="'+esc(c.id)+'" data-focus="case-'+esc(c.id)+'" aria-pressed="'+(state.activeCase===c.id)+'"><span class="incident-number"><span>FILE '+String(c.n).padStart(3,"0")+'</span><span>'+(c.at.received?hhmm(c.at.received):"")+'</span></span><span class="incident-title">'+label+'</span><span class="incident-sub"><span class="mono">'+esc(m.invoiceId?.replace("INV-2026-","INV / ")??"Northwind")+'</span><span class="'+m.status+'">'+(m.proposal?.type==="CHANGE_BANK"&&m.change?.status==="approved"?"Approved":m.proposal?.type==="CHANGE_BANK"&&m.change?.status==="rejected"?"Rejected":STAMP[m.status])+'</span></span></button>';
  }).join(""):'<p class="quiet loading">'+(state.query?"No matching cases.":"No cases in this session.")+'</p>');
}
function renderEmail(c,tab) {
  const text=c.email?.text??"",i=text.indexOf("\n-----\n"),body=i<0?text:text.slice(0,i),invoice=i<0?"":text.slice(i+7);
  const from=c.email?.from??"Awaiting message";
  const parts=[];
  function prose(s) {
    return s.trim().split(/\n\s*\n/).filter(Boolean).map(p=>'<p class="'+(/AP-BOT INSTRUCTION/.test(p)?"injection":/Routing number|Account number/.test(p)?"bank-instruction":"")+'">'+esc(p)+'</p>').join("");
  }
  let cursor=0;
  for(const match of body.matchAll(/\x60{3}python\s*\n([\s\S]*?)\x60{3}/gi)){
    parts.push(prose(body.slice(cursor,match.index)));
    parts.push('<details class="inline-code"><summary>Embedded Python “confirmation script”</summary><pre>'+esc(match[1].trim())+'</pre></details>');
    cursor=match.index+match[0].length;
  }
  parts.push(prose(body.slice(cursor)));
  return '<div class="section-heading"><h2><span class="section-num">01</span>Source evidence</h2><div class="evidence-tabs" role="group" aria-label="Source document"><button data-evidence="email" data-focus="source-email" aria-pressed="'+(tab==="email")+'">Email</button><button data-evidence="invoice" data-focus="source-invoice" aria-pressed="'+(tab==="invoice")+'">Invoice</button></div></div><div class="source-document"><div class="source-meta">'+(tab==="email"?'<dl><dt>From</dt><dd>'+esc(from)+'</dd><dt>To</dt><dd>'+esc(state.inboxes.ap)+'</dd><dt>Subject</dt><dd class="subject">'+esc(c.email?.subject)+'</dd></dl>':'<span class="eyebrow">ATTACHED INVOICE</span><p class="subject">Original supplier document</p>')+'</div><div class="document-body '+(tab==="invoice"?"invoice-body":"")+'" data-scroll="document-'+c.n+'-'+tab+'">'+(tab==="email"?parts.join(""):invoice?esc(invoice):"No invoice attachment in this message.")+'</div><div class="document-footer"><span>'+(c.id.startsWith("offline-")?"Local email fixture":"Received email")+'</span><span>'+ (tab==="email"?"Source content is untrusted":"Original invoice content")+'</span></div></div>';
}
function quickCheck(label,check,positive,negative) {
  return '<div class="quick-check"><dt>'+label+'</dt><dd class="'+(check?check.ok?"pass":"fail":"")+'">'+(check?check.ok?positive:negative:"Awaiting evaluation")+'</dd></div>';
}
function renderComparison(m) {
  const {approved,proposed,onFile,bankCheck,status}=m;
  const target=onFile?approved:proposed;
  const differs=!!target&&!!approved&&(String(target.routing).replace(/\D/g,"")!==String(approved.routing).replace(/\D/g,"")||String(target.account).replace(/\D/g,"")!==String(approved.account).replace(/\D/g,""));
  const result=status==="BLOCKED"?"Payment blocked.":status==="EXECUTED"?"Payment executed.":status==="PENDING_APPROVAL"?"Verification required.":status==="ERROR"?"Run failed.":status==="NO_ACTION"?"No action taken.":"Decision pending.";
  const reason=status==="BLOCKED"?bankCheck?.ok===false?"The proposed destination is not authorized for this invoice. No payment was executed for this request.":m.decision?.summary:
    status==="EXECUTED"?"The ledger executed this payment to the approved account shown above.":
    status==="PENDING_APPROVAL"?(m.proposal?.type==="CHANGE_BANK"?"Email cannot authorize a bank change. The approved record stays unchanged until a callback is recorded.":"This payment is held until the outstanding verification requirements are resolved."):
    status==="ERROR"?m.c.error:status==="NO_ACTION"?m.decision?.summary:"The agent’s proposal will be evaluated against the ledger record.";
  return '<div class="section-heading"><h2><span class="section-num">02</span>Destination check</h2><span class="eyebrow">'+(m.invoiceId?esc(m.invoiceId):"PAYEE RECORD")+'</span></div><div class="bank-comparison"><div class="bank-labels"><div><strong>Proposed by agent</strong><small>'+(onFile?"Use the account on file":proposed?"Extracted from this email":"Awaiting proposal")+'</small></div><div><strong>Approved payee</strong><small>'+(m.referenceCaptured?"Record at evaluation":"Current ledger record")+'</small></div></div><div class="bank-row"><div class="'+(differs?"different":"")+'"><label>Account number</label><span class="bank-number">'+esc(target?.account??"—")+'</span></div><div><label>Account number</label><span class="bank-number">'+esc(approved?.account??"—")+'</span></div></div><div class="bank-row"><div class="'+(differs?"different":"")+'"><label>Routing number</label><span class="routing">'+esc(target?.routing??"—")+'</span></div><div><label>Routing number</label><span class="routing">'+esc(approved?.routing??"—")+'</span></div></div></div><p class="comparison-note">'+(differs?"The email requests a different bank account.":onFile?"The agent requested payment to the existing account on file.":"Payment destinations are resolved from the invoice’s payee record.")+'</p><div class="verdict '+status+'"><div class="verdict-head"><span class="eyebrow">'+(m.change&&m.change.status!=="pending"?"INITIAL DECISION":"LEDGER DECISION")+'</span><h3>'+result+'</h3></div><p>'+esc(reason)+'</p>'+(m.change&&m.change.status!=="pending"?'<p class="resolution-note">'+(m.change.status==="approved"?"Callback attestation subsequently recorded; the payee register now uses the new account.":"This bank-change request was subsequently rejected.")+'</p>':"")+(m.change?'<button class="text-button" data-open-queue>'+(m.change.status==="pending"?"Review bank-change request":"View "+esc(m.change.status)+" bank change")+' <span aria-hidden="true">↗</span></button>':"")+'</div><dl class="quick-checks">' + quickCheck("Sender on vendor record",m.senderCheck,"Match","Not on file")+(m.proposal?.type==="PAY"?quickCheck("Amount matches invoice",m.amountCheck,"Match","Mismatch")+quickCheck("Destination binding",bankCheck,"Match","Mismatch"):quickCheck("Email may change payee",m.decision?.checks?.find(c=>c.name==="email content may change approved payee"),"Allowed","Never"))+'</dl>';
}
function logBlock(text) {
  const lines=String(text??"").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"").trimEnd().split("\n");
  return '<div class="log">'+lines.map((s,i)=>'<div class="log-line '+(/vendor-supplied|urllib|vendors\.json|Error|confirm failed/.test(s)?"mark":"")+'"><i>'+(i+1)+'</i><span>'+(esc(s)||" ")+'</span></div>').join("")+'</div>';
}
function renderDiagnostics(c) {
  const tab=state.detailTab;
  let content="";
  if(tab==="script") content='<p class="diagnostic-note">'+(c.mode==="scripted"?"Deterministic scripted agent.":"Configured mode: Claude. Individual steps may fall back to scripted execution.")+' Any vendor-supplied code is treated as untrusted input.</p>'+logBlock(c.code??"The agent has not produced an extractor.");
  if(tab==="output") content='<p class="diagnostic-note">Output annotations use text matching. Failure to reach the fixture’s .example hostname is not an independent test of network isolation.</p><span class="eyebrow">STDOUT</span>'+logBlock(c.sandbox?.stdout??"Awaiting sandbox output.")+'<br><span class="eyebrow">STDERR</span>'+logBlock(c.sandbox?.stderr?.trim()||"No stderr output.");
  if(tab==="checks") content=c.decisions.length?c.decisions.map(d=>'<div class="decision-group"><h3>'+esc(d.proposal.type??"NO_ACTION")+' / '+esc(d.status)+'</h3>'+(d.checks??[]).slice().sort((a,b)=>Number(a.ok)-Number(b.ok)).map(k=>'<div class="full-check"><span class="'+(k.ok?"pass":"fail")+'">'+(k.ok?"✓":"×")+'</span><span>'+esc(k.name)+'</span><small>'+esc(k.detail)+'</small></div>').join("")+'</div>').join(""):'<p class="diagnostic-note">Awaiting ledger evaluation.</p>';
  if(tab==="proposal") content=logBlock(JSON.stringify(c.proposals??[],null,2));
  return '<details class="diagnostics" id="diagnostics" '+(state.diagnosticsOpen?"open":"")+'><summary>Inspect execution evidence <span>Generated code, sandbox output, and every ledger check</span></summary><div class="diagnostic-tabs" role="group" aria-label="Execution evidence">'+[["script","Agent script"],["output","Sandbox output"],["checks","Ledger checks"],["proposal","Proposed actions"]].map(([k,t])=>'<button data-diagnostic="'+k+'" data-focus="diag-'+k+'" aria-pressed="'+(tab===k)+'">'+t+'</button>').join("")+'</div><div class="diagnostic-content">'+content+(c.reply?'<details class="inline-code"><summary>Reply sent to '+esc(c.reply.to)+'</summary>'+logBlock(c.reply.text)+'</details>':"")+(c.error&&c.decisions.length?'<p class="form-error">Pipeline error after decision: '+esc(c.error)+'</p>':"")+'</div></details>';
}
function renderInvestigation() {
  const c=state.cases.get(state.activeCase);
  if(!c) {
    replaceHTML("#investigation",'<div class="initial-state"><div class="initial-rule"></div><span class="eyebrow">PAYMENT INVESTIGATIONS / LOCAL DEMO</span><h1>Follow the instruction.<br>Inspect the destination.</h1><p>Run a supplier payment through the agent, then compare its proposed account with the approved payee record.</p><button class="button button-primary" data-run="attack" '+(!state.connected||state.busy?"disabled":"")+'>Run payment diversion <span aria-hidden="true">→</span></button> <button class="text-button" data-open-demo>All scenarios</button></div>');
    return;
  }
  const m=modelFor(c);
  const heading=m.status==="BLOCKED"?(m.bankCheck?.ok===false?"An unapproved destination.":"A payment request rejected."):m.status==="EXECUTED"?"The approved account, paid.":m.proposal?.type==="CHANGE_BANK"?(m.change?.status==="approved"?"A bank change, verified.":m.change?.status==="rejected"?"A bank change rejected.":"A change awaiting verification."):m.status==="ERROR"?"The run could not complete.":m.status==="PENDING_APPROVAL"?"A payment awaiting review.":m.status==="NO_ACTION"?"No payment action proposed.":"A payment under review.";
  const duration=c.at.decision?new Date(c.at.decision)-new Date(c.at.received):null;
  const html='<div class="case-kicker"><span class="mono">CASE / '+String(c.n).padStart(3,"0")+'</span><span>'+(c.id.startsWith("offline-")?"Local scenario":"Inbound email")+'</span><span class="mono">'+(c.at.received?hhmm(c.at.received):"")+'</span><button data-export="'+esc(c.id)+'">Export evidence ↗</button></div><div class="incident-heading"><div><p class="vendor-line">'+esc(m.vendorName)+'</p><h1>'+heading+'</h1></div>'+(m.amount!=null?'<div class="incident-amount">'+money(m.amount)+'<small>'+esc(m.invoiceId??"")+' · USD</small></div>':"")+'</div><div class="investigation-grid"><section aria-label="Original supplier evidence">'+renderEmail(c,state.evidenceTab)+'</section><section aria-label="Proposed and approved payment destinations">'+renderComparison(m)+'</section></div><div class="execution-strip" aria-label="Execution boundary"><div><label>Execution boundary</label><strong>Wasmer / WASIX</strong></div><div><label>Network policy</label><span>'+esc(state.sandbox?.network??"Unavailable")+'</span></div><div><label>Payee records</label><span>'+(state.sandbox?.notMounted?.length?"Not mounted in guest":"Policy unavailable")+'</span></div><div><label>Guest execution</label><span>'+(c.sandbox?"Exit "+c.sandbox.exitCode+" · "+ms(c.sandbox.ms):c.error?"Did not complete":"Awaiting result")+'</span></div></div>'+renderDiagnostics(c);
  replaceHTML("#investigation",html);
}
function renderLedger() {
  const L=state.ledger;if(!L)return;
  $("#m-paid").textContent=money(L.payments.reduce((sum,p)=>sum+p.amount,0));
  $("#m-stopped").textContent=money(L.decisions.filter(d=>d.status==="BLOCKED"&&d.proposal.type==="PAY").reduce((sum,d)=>sum+Number(d.proposal.amount||0),0));
  $("#m-held").textContent=String(L.pendingChanges.filter(c=>c.status==="pending").length);
  replaceHTML("#vendors",L.vendors.map(v=>'<article class="payee-record"><div><h2>'+esc(v.name)+'</h2><span class="mono">'+esc(v.id)+'</span></div><dl><dt>Account</dt><dd class="mono">'+esc(v.bank.account)+'</dd><dt>Routing</dt><dd class="mono">'+esc(v.bank.routing)+'</dd><dt>Contact</dt><dd>'+esc(v.contacts.join(", "))+'</dd><dt>Verification</dt><dd>'+esc(v.bankVerifiedVia)+'</dd></dl></article>').join(""));
  replaceHTML("#invoices",'<thead><tr><th scope="col">Invoice</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" class="num">Amount</th></tr></thead><tbody>'+L.invoices.map(i=>'<tr><td class="id">'+esc(i.id)+'</td><td>'+esc(i.due)+'</td><td>'+esc(i.status)+'</td><td class="num">'+money(i.amount)+'</td></tr>').join("")+'</tbody>');
  replaceHTML("#payments",L.payments.length?'<thead><tr><th scope="col">Invoice</th><th scope="col">Destination</th><th scope="col" class="num">Amount</th></tr></thead><tbody>'+L.payments.map(p=>'<tr><td class="id">'+esc(p.invoiceId)+'</td><td class="mono">'+esc(bank(p.bank))+'</td><td class="num">'+money(p.amount)+'</td></tr>').join("")+'</tbody>':'<tbody><tr><td>No payments executed in this session.</td></tr></tbody>');
}
function renderApprovals() {
  const changes=(state.ledger?.pendingChanges??[]).slice().reverse(),pending=changes.filter(c=>c.status==="pending"),settled=changes.filter(c=>c.status!=="pending");
  $("#approvals-count").textContent=String(pending.length).padStart(2,"0");
  let html=pending.length?"":'<div class="queue-empty">No bank changes awaiting review.<p>Approved accounts remain on the payee register.</p></div>';
  html+=(state.showResolved?[...pending,...settled]:pending).map(c=>'<div class="approval"><div class="approval-row1"><strong>'+esc(c.vendorName)+'</strong><span class="approval-state">'+(c.status==="pending"?"Awaiting callback":esc(c.status))+'</span></div><div class="approval-bank">'+esc(c.currentBank?.account)+' <span aria-hidden="true">→</span> '+esc(c.proposedBank?.account)+'</div><div class="approval-by '+(c.source?.from===state.inboxes.attacker?"attacker":"")+'">'+esc(c.source?.from)+'</div>'+(c.status==="pending"?'<div class="approval-actions"><button class="button" data-approve="'+esc(c.id)+'" data-focus="approve-'+esc(c.id)+'">Record callback</button><button class="text-button" data-reject="'+esc(c.id)+'" data-focus="reject-'+esc(c.id)+'">Reject request</button></div>':'<div class="approval-result">'+esc(c.approver)+' · '+esc(c.method??c.reason)+'</div>')+'</div>').join("");
  if(settled.length)html+='<button class="resolved-toggle" data-resolved aria-expanded="'+state.showResolved+'">'+(state.showResolved?"Hide":"Show")+" "+settled.length+' resolved request'+(settled.length===1?"":"s")+'</button>';
  replaceHTML("#approvals",html);
}
function scenarioState(key) {
  const c=state.order.map(id=>state.cases.get(id)).find(c=>c.email?.subject===state.scenarios[key]?.subject);
  return c?STAMP[outcomeOf(c)]:state.sent.has(key)?"Email sent":"Ready";
}
function renderRunbook() {
  replaceHTML("#runbook",RUNBOOK.map((key,i)=>'<li><button data-select="'+i+'" data-focus="scenario-'+i+'" aria-pressed="'+(state.selected===i)+'"><span>'+String(i+1).padStart(2,"0")+'</span><span><strong>'+SCENARIO_UI[key].title+'</strong><small>'+SCENARIO_UI[key].meta+'</small></span><span class="run-status">'+scenarioState(key)+'</span></button></li>').join(""));
  const key=RUNBOOK[state.selected],disabled=!state.ledger||!state.connected||!!state.busy||isRunning();
  replaceHTML("#scenario-detail",'<p class="scenario-description">'+SCENARIO_UI[key].description+'</p><div class="scenario-actions"><button class="button button-primary" data-run="'+key+'" data-focus="run" '+(disabled?"disabled":"")+'>'+(state.busy===key?"Running…":"Run locally")+' →</button><button class="button" data-send="'+key+'" '+(disabled||state.mailStatus!=="connected"?"disabled":"")+' title="'+(state.mailStatus==="connected"?"Send a real email":"Live mail is unavailable")+'">Send live email</button></div><p class="scenario-help">Local runs skip email delivery. All payments are simulated ledger entries.</p>');
}
async function post(url,body) {
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body ?? {})});
  const data=await r.json();
  if (!r.ok) throw new Error(data.error ?? r.statusText);
  return data;
}
async function runScenario(key,live=false) {
  if (state.busy || isRunning() || !state.connected) return;
  if (!RUNBOOK.includes(key)) return;
  if (live && state.mailStatus !== "connected") return;
  state.selected=RUNBOOK.indexOf(key); state.busy=key; $("#demo-dialog").close(); state.view="investigation"; renderAll();
  try {
    await post("/api/scenario/"+key+(live?"/send":"/run"));
    await syncState(false);
    if (live) toast("Scenario email sent","Waiting for the inbox listener.");
    else {
      const c=state.order.map(id=>state.cases.get(id)).find(x=>x.email?.subject===state.scenarios[key].subject);
      if (c?.error) toast("Scenario failed",c.error);
      if (c) { state.activeCase=c.id; state.query=""; $("#case-search").value=""; state.evidenceTab="email"; state.diagnosticsOpen=false; }
    }
  } catch (err) { toast("Could not run scenario",err.message); }
  finally { state.busy=null; renderAll(); }
}
function openDialog(kind,id) {
  const dialog=$("#action-dialog");
  const c=state.ledger?.pendingChanges.find(x=>x.id===id);
  state.modal={kind,id};
  $("#dialog-error").hidden=true;
  $("#dialog-submit").hidden=false;
  $("#dialog-submit").disabled=false;
  $("#dialog-submit").textContent=kind==="reset" ? "Reset demo" : kind==="approve" ? "Record callback & approve" : "Reject change";
  $("#dialog-submit").className="button button-primary";
  $("#dialog-eyebrow").textContent=kind==="policy" ? "EXECUTION BOUNDARY" : kind==="reset" ? "DEMO WORKSPACE" : "HUMAN VERIFICATION";
  if (kind==="reset") {
    $("#dialog-title").textContent="Start a fresh demo?";
    $("#dialog-content").innerHTML='<p>This resets the simulated ledger, payments, bank changes, and activity. All fixture payees and invoices return to their starting state.</p>';
  } else if (kind==="policy") {
    const s=state.sandbox;
    $("#dialog-title").textContent="Wasmer sandbox policy";
    $("#dialog-content").innerHTML='<p>Agent-generated code runs with a limited filesystem and no network access. The ledger evaluates proposals separately.</p><dl class="policy-list">' + [
      ["Runtime",s?.runtime ?? "Unavailable"],["Network",s?.network ?? "Unavailable"],["Mounted files",(s?.mounts ?? []).join(", ")],
      ["Outside the sandbox",(s?.notMounted ?? []).join(", ")],["Command timeout",ms(s?.timeoutMs)]
    ].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join("") + '</dl><p>Output-based denial labels are diagnostic evidence, not an independent audit of isolation.</p><p>This is an unauthenticated local prototype with simulated payments. Callback approval records an attestation. Configured Claude steps may fall back to scripted execution.</p>';
    $("#dialog-submit").hidden=true;
  } else {
    if (!c || c.status!=="pending") { toast("This change is already resolved"); return; }
    const v=state.ledger.vendors.find(v=>v.id===c.vendorId);
    $("#dialog-title").textContent=kind==="approve" ? "Record callback verification" : "Reject bank change";
    const common='<div class="dialog-record"><span class="label">'+esc(c.vendorName)+'</span><span class="mono">'+esc(bank(c.currentBank))+' → '+esc(bank(c.proposedBank))+'</span><p>Requested by '+esc(c.source?.from)+'</p></div>';
    $("#dialog-content").innerHTML=kind==="approve"
      ? '<p>Use the existing vendor record to verify the change independently. This demo records your attestation; it does not place or verify a phone call.</p>'+common+'<div class="dialog-record"><span class="label">Existing verification record</span>'+esc(v?.bankVerifiedVia)+'<p>Approved contact: '+esc(v?.contacts.join(", "))+'</p></div><label class="confirm-check"><input id="callback-confirmed" type="checkbox" required><span>I completed an independent callback using the contact already on file and confirmed these bank details.</span></label>'
      : '<p>Keep the approved account unchanged and record why this request was rejected.</p>'+common+'<label class="field-label" for="reject-reason">Reason for rejection</label><textarea id="reject-reason" name="reason" required maxlength="500" placeholder="Describe the verification outcome"></textarea>';
  }
  dialog.showModal();
}
$("#dialog-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const {kind,id}=state.modal ?? {};
  const submit=$("#dialog-submit");
  if (submit.disabled) return;
  submit.disabled=true; $("#dialog-error").hidden=true;
  try {
    if (kind==="reset") {
      if (isRunning()) throw new Error("Wait for the current scenario to finish before resetting.");
      await post("/api/reset");
      state.cases.clear(); state.order=[]; state.sent.clear(); state.activeCase=null; state.selected=0; state.query=""; state.view="investigation"; state.diagnosticsOpen=false; state.showResolved=false; $("#case-search").value="";
    } else if (kind==="approve") {
      if (!$("#callback-confirmed").checked) throw new Error("Confirm that you completed the independent callback.");
      await post("/api/changes/"+encodeURIComponent(id)+"/approve",{approver:"Priya Natarajan, AP Manager",method:"Phone callback to number on file"});
    } else if (kind==="reject") {
      const reason=$("#reject-reason").value.trim();
      if (!reason) throw new Error("Enter a reason for rejecting this change.");
      await post("/api/changes/"+encodeURIComponent(id)+"/reject",{approver:"Priya Natarajan, AP Manager",reason});
    }
    await syncState(false); $("#action-dialog").close(); renderAll();
    if (kind==="reset") toast("Demo reset","Ready for the first scenario.");
  } catch (err) { $("#dialog-error").textContent=err.message; $("#dialog-error").hidden=false; }
  finally { submit.disabled=false; }
});
function exportEvidence(id) {
  const c=state.cases.get(id); if (!c) return;
  const url=URL.createObjectURL(new Blob([JSON.stringify({product:"PayeeLock",environment:"simulated payments",configuredAgentMode:state.agentMode,case:c},null,2)],{type:"application/json"}));
  const a=document.createElement("a"); a.href=url; a.download="payeelock-case-"+String(c.n).padStart(4,"0")+".json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast("Evidence exported","Includes the email, code, sandbox output, and ledger checks.");
}

function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  $("#btn-theme").textContent=theme==="dark"?"Light appearance":"Dark appearance";
  try{localStorage.setItem("payeelock-theme",theme);}catch{/* Storage is optional. */}
}
function openQueue(){
  const c=state.cases.get(state.activeCase),change=c&&modelFor(c).change;
  if(change&&change.status!=="pending")state.showResolved=true;
  renderApprovals();$("#queue-dialog").showModal();
}
document.addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t||t.disabled)return;
  if(t.dataset.run)await runScenario(t.dataset.run);
  else if(t.dataset.send)await runScenario(t.dataset.send,true);
  else if(t.dataset.select!==undefined){state.selected=Number(t.dataset.select);renderRunbook();}
  else if(t.dataset.view){state.view=t.dataset.view;renderView();}
  else if(t.dataset.case){state.activeCase=t.dataset.case;state.view="investigation";state.evidenceTab="email";state.diagnosticsOpen=false;renderIncidents();renderInvestigation();renderView();}
  else if(t.dataset.evidence){state.evidenceTab=t.dataset.evidence;renderInvestigation();}
  else if(t.dataset.diagnostic){state.detailTab=t.dataset.diagnostic;state.diagnosticsOpen=true;renderInvestigation();}
  else if(t.hasAttribute("data-open-demo")||t.id==="btn-demo"){renderRunbook();$("#demo-dialog").showModal();}
  else if(t.hasAttribute("data-close-demo"))$("#demo-dialog").close();
  else if(t.hasAttribute("data-open-queue")||t.id==="btn-queue")openQueue();
  else if(t.hasAttribute("data-close-queue"))$("#queue-dialog").close();
  else if(t.hasAttribute("data-resolved")){state.showResolved=!state.showResolved;renderApprovals();}
  else if(t.dataset.approve)openDialog("approve",t.dataset.approve);
  else if(t.dataset.reject)openDialog("reject",t.dataset.reject);
  else if(t.dataset.export)exportEvidence(t.dataset.export);
  else if(t.id==="btn-reset")openDialog("reset");
  else if(t.id==="btn-policy-status")openDialog("policy");
  else if(t.id==="btn-theme")setTheme(document.documentElement.dataset.theme==="dark"?"light":"dark");
  else if(t.hasAttribute("data-close-dialog"))$("#action-dialog").close();
  else if(t.hasAttribute("data-retry"))await boot();
});
$("#case-search").addEventListener("input",e=>{state.query=e.target.value.trim().toLowerCase();renderIncidents();});
document.addEventListener("toggle",e=>{
  if(e.target.id==="diagnostics"&&e.target.isConnected)state.diagnosticsOpen=e.target.open;
},true);
document.addEventListener("keydown",e=>{
  if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.repeat||document.querySelector("dialog[open]"))return;
  if(e.target.closest("button,a,input,textarea,select,summary,[contenteditable]"))return;
  if(/^[1-4]$/.test(e.key)){e.preventDefault();state.selected=Number(e.key)-1;renderRunbook();$("#demo-dialog").showModal();}
  if(e.key==="Enter"){e.preventDefault();runScenario(RUNBOOK[state.selected]);}
});
function toast(text,detail){
  const box=$("#toasts");while(box.children.length>=3)box.firstChild.remove();
  const el=document.createElement("div");el.className="toast";
  el.innerHTML='<div class="t">'+esc(text)+'</div>'+(detail?'<div class="d">'+esc(detail)+'</div>':"");box.appendChild(el);
  setTimeout(()=>{el.classList.add("out");setTimeout(()=>el.remove(),160);},5000);
}
try{setTheme(localStorage.getItem("payeelock-theme")==="dark"?"dark":"light");}catch{setTheme("light");}
boot();
