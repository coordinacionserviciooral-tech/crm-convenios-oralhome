import test from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../supabase/functions/power-automate-alerts/provider.js';
import { deliverAlert } from '../supabase/functions/power-automate-alerts/delivery.js';
const claim = { id:1, attempts:1, alert_key:'1:activity:date:8:am', payload:{provider:'emailjs', template_params:{to_email:'test@example.com',compañia:'Test'}} };
const config = {provider:'emailjs',serviceId:'service',templateId:'template',publicKey:'public',privateKey:'private'};
test('EmailJS server requests use existing template fields and private key',async()=>{
  const result = await sendMessage(claim,config,async(url,request)=>{assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send');const data=JSON.parse(request.body);assert.equal(data.accessToken,'private');assert.equal(data.template_params.compañia,'Test');assert.ok(!request.body.includes('queued_at'));return new Response('OK',{status:200});});assert.ok(result.id.startsWith('emailjs:'));
});
test('provider rate rejection is retryable; ambiguous network failure is flagged',async()=>{
  await assert.rejects(sendMessage(claim,config,async()=>new Response('Rate limit',{status:429})),error=>!error.uncertain);
  await assert.rejects(sendMessage(claim,config,async()=>{throw new Error('Timeout')}),error=>error.uncertain===true);
});
test('EmailJS delivery and database acknowledgement failures require manual review instead of duplicate retry',async()=>{
  let patch;const adapter={claim:async()=>claim,send:async()=>({id:'sent'}),finish:async(_,value)=>{if(value.status==='sent')throw new Error('DB offline');patch=value;}};
  assert.equal(await deliverAlert({},adapter),'uncertain');assert.equal(patch.status,'uncertain');assert.equal(patch.sent_at,null);
});
test('Resend requests retain same idempotency key on retries and omit internal metadata',async()=>{
  const resend={...claim,payload:{provider:'resend',from:'crm@example.com',to:['test@example.com'],subject:'Alert',html:'<p>Alert</p>',queued_at:'internal',template_params:{}}};let key;
  for(let i=0;i<2;i++)await sendMessage(resend,{provider:'resend',apiKey:'server'},async(_,request)=>{const current=request.headers['Idempotency-Key'];if(key)assert.equal(current,key);key=current;assert.ok(!request.body.includes('queued_at'));return Response.json({id:'one-email'});});
});
