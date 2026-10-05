import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import Finance from './Finance';
import './globals.css';
import './migration.css';
function App(){
 const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{supabase.auth.getSession().then(({data})=>{setSession(data.session);setReady(true)});const {data}=supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);setReady(true)});return()=>data.subscription.unsubscribe()},[]);
 async function login(e:FormEvent){e.preventDefault();setBusy(true);const {error}=await supabase.auth.signInWithPassword({email,password});setError(error?.message??'');setPassword('');setBusy(false)}
 if(!ready)return <div className="auth-panel">Loading…</div>;
 if(!session)return <form className="auth-panel" onSubmit={login}><h1>Nilesh Finance Analyst</h1><p>Sign in to your private finance dashboard.</p><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>{busy?'Signing in…':'Sign in'}</button>{error&&<p role="alert">{error}</p>}<small>Your website login is separate from your Supabase dashboard account.</small></form>;
 window.sessionStorage.setItem('finance-user',session.user.id);
 return <Finance key={session.user.id}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
