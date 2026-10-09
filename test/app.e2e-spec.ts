import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import cookieParser = require('cookie-parser');
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

describe('sandbox API (e2e)', () => {
  let app: INestApplication;
  const base='/api/v1';
  beforeAll(async()=>{const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication();app.use(cookieParser());app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));await app.init();});
  afterAll(async()=>app?.close());
  it('health reports the API and database state without secrets',async()=>{const r=await request(app.getHttpServer()).get('/api/v1/health').expect(200);expect(r.body).toHaveProperty('backend');expect(JSON.stringify(r.body)).not.toMatch(/password|secret|token/i);});
  it('rejects unauthenticated access to company data',async()=>{await request(app.getHttpServer()).get('/api/v1/companies/current').expect(401);});
  it('rejects undeclared input such as a client-supplied tenant identifier',async()=>{
    const r=await request(app.getHttpServer()).post(`${base}/auth/login`).send({email:'demo@aida.test',password:process.env.DEMO_PASSWORD||'Demo-AIDA-2026!',companyId:'attacker-controlled'}).expect(400);
    expect(JSON.stringify(r.body)).not.toMatch(/password|secret|token/i);
  });
  it('isolates customer reads and draft writes between the seeded companies',async()=>{
    const a=request.agent(app.getHttpServer()), b=request.agent(app.getHttpServer());
    const la=await a.post(`${base}/auth/login`).send({email:'demo@aida.test',password:process.env.DEMO_PASSWORD||'Demo-AIDA-2026!'}).expect(201);
    const lb=await b.post(`${base}/auth/login`).send({email:'beta@aida.test',password:process.env.DEMO_PASSWORD||'Demo-AIDA-2026!'}).expect(201);
    const csrf=(r:any):string=>String(r.headers['set-cookie']||[]).split(',').map((s:string)=>s.match(/aida_csrf=([^;]+)/)?.[1]).find(Boolean)||'';
    const csrfA=csrf(la), csrfB=csrf(lb);
    const c=await a.get(`${base}/customers`).expect(200); expect(c.body.length).toBeGreaterThan(0);
    await b.get(`${base}/customers/${c.body[0].id}`).expect(404);
    const cross=await b.post(`${base}/invoices/drafts`).set('X-CSRF-Token',csrfB).set('Idempotency-Key',`cross-${Date.now()}`).send({customerId:c.body[0].id,items:[{satKey:'01010101',description:'Prueba',unit:'E48',quantity:'1',unitPrice:'10'}]}).expect(404);
    expect(JSON.stringify(cross.body)).not.toMatch(/password|secret|token/i);
    const key=`own-${Date.now()}`;
    const payload={customerId:c.body[0].id,items:[{satKey:'01010101',description:'Prueba aislada',unit:'E48',quantity:'1',unitPrice:'10',taxRate:'0.16'}]};
    const [own, concurrent] = await Promise.all([
      a.post(`${base}/invoices/drafts`).set('X-CSRF-Token',csrfA).set('Idempotency-Key',key).send(payload),
      a.post(`${base}/invoices/drafts`).set('X-CSRF-Token',csrfA).set('Idempotency-Key',key).send(payload),
    ]);
    expect(own.status).toBe(201);
    expect(concurrent.status).toBe(201);
    expect(concurrent.body.id).toBe(own.body.id);
    expect(own.body).not.toHaveProperty('companyId');
    expect(own.body).not.toHaveProperty('idempotencyKey');
    const repeated=await a.post(`${base}/invoices/drafts`).set('X-CSRF-Token',csrfA).set('Idempotency-Key',key).send(payload).expect(201);
    expect(repeated.body.id).toBe(own.body.id);
    expect(repeated.body.total).toBe(own.body.total);
    await b.get(`${base}/invoices/drafts/${own.body.id}`).expect(404);
    await b.patch(`${base}/invoices/drafts/${own.body.id}`).set('X-CSRF-Token',csrfB).send({customerId:c.body[0].id,items:[{satKey:'01010101',description:'No permitido',unit:'E48',quantity:'1',unitPrice:'1'}]}).expect(404);
    const stamped=await a.post(`${base}/invoices/drafts/${own.body.id}/simulate-stamp`).set('X-CSRF-Token',csrfA).expect(201);
    expect(stamped.body.status).toBe('STAMPED_SIMULATED');
    expect(stamped.body.simulatedStampId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stamped.body.stampSimulation.fiscalValidity).toBe('none');
    expect(stamped.body.stampSimulation.message).toMatch(/No se generó CFDI/);
    expect(stamped.body).not.toHaveProperty('companyId');
    await b.post(`${base}/invoices/drafts/${own.body.id}/simulate-stamp`).set('X-CSRF-Token',csrfB).expect(404);
    const repeatedStamp=await a.post(`${base}/invoices/drafts/${own.body.id}/simulate-stamp`).set('X-CSRF-Token',csrfA).expect(201);
    expect(repeatedStamp.body.simulatedStampId).toBe(stamped.body.simulatedStampId);
    await a.patch(`${base}/invoices/drafts/${own.body.id}`).set('X-CSRF-Token',csrfA).send(payload).expect(403);
    const probe=await a.post(`${base}/integrations/ghl/simulate-connectivity`).set('X-CSRF-Token',csrfA).expect(201);
    expect(probe.body.result).toBe('simulated');
    expect(probe.body.externalRequestSent).toBe(false);
    expect(probe.body.correlationId).toBeTruthy();
  });
});
