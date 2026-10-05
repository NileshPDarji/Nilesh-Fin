import { supabase } from './supabase';
let revision = 0;
let tail: Promise<unknown> = Promise.resolve();
export const financeFetch = Object.assign(async function(url: string, init?: RequestInit): Promise<Response> {
 if(url === '/api/market') {
  const {data,error} = await supabase.functions.invoke('finance-market');
  return Response.json(error ? {error:error.message} : data, {status:error?503:200});
 }
 if(init?.method === 'POST') {
  const state = JSON.parse(String(init.body)).state;
  const operation = tail.then(async()=> {
   const {data,error} = await supabase.rpc('save_finance_state',{p_payload:state,p_expected_revision:revision});
   if(error) throw error;
   revision=data.revision;
   return Response.json(data);
  });
  tail=operation.catch(()=>{});
  try {return await operation;} catch(error) { return Response.json({error: String(error)}, {status:409}); }
 }
 financeFetch.loaded=false;
 const {data,error}=await supabase.from('finance_state').select('payload,revision,updated_at').maybeSingle();
 if(error) return Response.json({error:error.message},{status:500});
 revision=data?.revision??0;
 financeFetch.loaded=true;
 return Response.json({state:data?.payload??null,revision,updatedAt:data?.updated_at??null});
},{loaded:false});
