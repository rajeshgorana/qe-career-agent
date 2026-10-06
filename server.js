const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const JOBS = path.join(DATA, 'jobs.json');
const PROFILE = path.join(DATA, 'profile.json');
const PORT = Number(process.env.PORT || 5500);

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function send(res, code, data, type='application/json') { res.writeHead(code, {'Content-Type': `${type}; charset=utf-8`, 'Cache-Control':'no-store'}); res.end(type==='application/json' ? JSON.stringify(data) : data); }
function body(req) { return new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}}); req.on('error',reject); }); }
function scoreJob(job, profile) {
  const text = `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase();
  const groups = {
    leadership: ['manager','lead','director','architect','head','15+ years','people leadership'],
    ai: ['ai','genai','generative ai','agentic','copilot','llm'],
    automation: ['playwright','selenium','automation','rest assured','api testing','bdd'],
    engineering: ['microservices','ci/cd','cicd','cloud','aws','azure','kubernetes','docker'],
    qe: ['quality engineering','quality','qe','test strategy','test architecture'],
    location: ['ncr','noida','gurugram','gurgaon','pune','bengaluru','bangalore','hyderabad','remote']
  };
  const weights={leadership:25,ai:20,automation:15,engineering:15,qe:15,location:10};
  const breakdown={}; let total=0;
  for(const [g,terms] of Object.entries(groups)) { const hits=terms.filter(t=>text.includes(t)); const pct=Math.min(100, Math.round(hits.length/Math.min(terms.length,3)*100)); breakdown[g]=pct; total += pct*weights[g]/100; }
  return {score: Math.max(35, Math.min(99, Math.round(total))), breakdown};
}
function enrich(job, profile) { const s=scoreJob(job,profile); return {...job, ...s}; }
async function aiAnalyze(job, profile) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return {mode:'local', ...localAnalysis(job, profile)};
  const prompt = `You are a senior QE career application analyst. Use ONLY facts in the profile. Never invent experience. Analyze the job and return JSON with keys: match_score (0-100), strengths (array), gaps (array), recommended_persona, recruiter_message, hiring_manager_message, cover_note, tailored_summary. Job: ${JSON.stringify(job)} Profile: ${JSON.stringify(profile)}`;
  const r = await fetch('https://api.openai.com/v1/responses', {method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`}, body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-6-luna', input:prompt})});
  if(!r.ok) throw new Error(`OpenAI API error ${r.status}: ${await r.text()}`);
  const j=await r.json(); const out=j.output_text||''; const match=out.match(/\{[\s\S]*\}/); if(!match) return {mode:'ai-text', text:out};
  try { return {mode:'openai', ...JSON.parse(match[0])}; } catch { return {mode:'ai-text', text:out}; }
}
function localAnalysis(job, profile) {
  const s=scoreJob(job,profile); const persona = job.title.toLowerCase().includes('ai')||job.description.toLowerCase().includes('agentic')?'AI / Agentic QE':job.title.toLowerCase().includes('architect')?'QE Architect / Test Architect':job.title.toLowerCase().includes('transformation')?'QE Transformation':'Senior QE Manager';
  return {match_score:s.score, recommended_persona:persona, strengths:['15+ years QE leadership','Automation strategy and test architecture','AI/Agentic QE positioning','Playwright, API and microservices quality engineering','CI/CD and cloud delivery'], gaps:['Verify any domain-specific requirements before applying','Confirm location/work-mode and compensation expectations'], recruiter_message:`Hi [Recruiter], I’m interested in the ${job.title} opportunity at ${job.company}. My background spans 15+ years in Quality Engineering leadership, automation strategy, AI/Agentic QE, API/microservices testing and CI/CD. I’d welcome a conversation about the role.`, hiring_manager_message:`Hello [Hiring Manager], I’m exploring the ${job.title} role because it aligns closely with my QE leadership and AI-driven quality engineering background. I have led distributed QE teams and automation transformation across complex product environments.`, cover_note:`I’m excited to apply for the ${job.title} role at ${job.company}. My experience combines QE strategy, automation architecture, AI/Agentic QE, API and microservices testing, CI/CD and people leadership. I would bring a transformation-oriented approach focused on measurable quality outcomes.`, tailored_summary:`Quality Engineering leader with 15+ years of experience across QE strategy, automation, AI/Agentic QE, API/microservices testing, CI/CD and team leadership.`};
}

if(!fs.existsSync(JOBS)) writeJson(JOBS,[
 {id:'zebra-001',company:'Zebra Technologies',title:'Senior Manager, Quality Engineering',location:'Bengaluru · Hybrid',description:'Lead quality engineering, automation strategy, GenAI and Agentic AI quality, microservices, CI/CD and people leadership.',status:'Ready for Approval',source:'Seeded'},
 {id:'infosys-001',company:'Infosys',title:'AI Quality Engineering Lead',location:'Bengaluru',description:'AI quality engineering leadership, automation, GenAI testing, API, microservices and CI/CD.',status:'Ready for Approval',source:'Seeded'},
 {id:'deloitte-001',company:'Deloitte',title:'Associate Director — Quality Engineering',location:'Pune',description:'QE transformation, automation testing, quality strategy, engineering leadership and delivery.',status:'Ready for Approval',source:'Seeded'},
 {id:'cap-001',company:'Capgemini',title:'QE Solution Architect / Pre-Sales Lead',location:'Gurugram / Noida',description:'QE solution architecture, automation, transformation, RFP/RFI and pre-sales.',status:'Shortlisted',source:'Seeded'},
 {id:'sample-001',company:'Example Corp',title:'Senior QA Automation Engineer',location:'Remote',description:'Senior automation engineering using Selenium, API testing and CI/CD.',status:'Watch',source:'Seeded'}
]);
if(!fs.existsSync(PROFILE)) writeJson(PROFILE,{name:'Rajesh',experience:'15+ years',roles:['Senior QE Manager','QE Transformation Lead','QE Architect / Test Architect','AI / Agentic QE Lead'],skills:['Quality Engineering','Automation Strategy','Playwright','Selenium','API Testing','Microservices','CI/CD','Cloud','AI/GenAI','Agentic AI','Test Architecture','People Leadership'],locations:['NCR/Noida/Gurugram','Pune','Bengaluru','Hyderabad','Remote']});

const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(url.pathname==='/api/jobs' && req.method==='GET'){ const p=readJson(PROFILE,{}); return send(res,200,readJson(JOBS,[]).map(j=>enrich(j,p))); }
    if(url.pathname==='/api/jobs' && req.method==='POST'){ const b=await body(req); const jobs=readJson(JOBS,[]); const job={id:crypto.randomUUID(),company:b.company||'Unknown Company',title:b.title||'Untitled Role',location:b.location||'Unspecified',description:b.description||'',status:'New',source:b.source||'Manual'}; jobs.unshift(job); writeJson(JOBS,jobs); return send(res,201,enrich(job,readJson(PROFILE,{}))); }
    if(url.pathname==='/api/profile' && req.method==='GET') return send(res,200,readJson(PROFILE,{}));
    if(url.pathname==='/api/analyze' && req.method==='POST'){ const b=await body(req); const profile=readJson(PROFILE,{}); const job=b.job||{}; const analysis=await aiAnalyze(job,profile); return send(res,200,analysis); }
    if(url.pathname==='/api/approve' && req.method==='POST'){ const b=await body(req); const jobs=readJson(JOBS,[]); const i=jobs.findIndex(j=>j.id===b.id); if(i<0) return send(res,404,{error:'Job not found'}); jobs[i].status='Approved — Ready for Human Submission'; jobs[i].approvedAt=new Date().toISOString(); writeJson(JOBS,jobs); return send(res,200,jobs[i]); }
    if(url.pathname==='/api/health') return send(res,200,{ok:true,ai:!!process.env.OPENAI_API_KEY});
    let file=url.pathname==='/'?'/index.html':url.pathname; const full=path.join(ROOT,path.normalize(file)); if(!full.startsWith(ROOT)) return send(res,403,{error:'Forbidden'}); if(!fs.existsSync(full)||fs.statSync(full).isDirectory()) return send(res,404,'Not found','text/plain'); const ext=path.extname(full); const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'}; return send(res,200,fs.readFileSync(full),types[ext]||'text/plain');
  } catch(e){ console.error(e); send(res,500,{error:e.message}); }
});
server.listen(PORT,'127.0.0.1',()=>console.log(`QE Career Agent Phase 2 running at http://127.0.0.1:${PORT}`));
