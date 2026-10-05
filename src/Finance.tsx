"use client";

import { financeFetch } from "./storage";
import { MonthlyRecords } from "./MonthlyRecords";
import { supabase } from "./supabase";
import { useEffect, useMemo, useState } from "react";
import {
  parseExcelStatement,
  type ImportedTransaction,
} from "./excel-statement-parser";

type Frequency = "One-time" | "Monthly" | "Bi-monthly" | "Quarterly" | "Half-yearly" | "Yearly";
type View = "Overview" | "Income" | "Expenses" | "Property Costs" | "Home Expenses" | "School Expenses" | "Properties" | "Investments" | "Forecast" | "Scenario Calculation" | "Retirement" | "Data Quality" | "Settings" | "Monthly Records";
type Entry = { id: number; name: string; category: string; amount: number; frequency: Frequency; active: boolean; date?: string; source?: string };
type Property = {
  id: number; name: string; type: string; cost: number; value: number; rent: number; rentStart: string; pending: number;
  address: string; electricityProvider: string; electricityId: string; gasProvider: string; gasId: string; taxId: string;
};
type Investment = { id: number; name: string; amount: number; value: number; addition: number; frequency: Frequency; startMonth: string; base: number; low: number; high: number };
type MarketQuote = {
  symbol: string; name: string; code: string; price: number | null; previousClose: number | null;
  change: number | null; changePercent: number | null; currency: string; updatedAt: string | null;
};
type FinanceState = {
  income: Entry[];
  spending: Entry[];
  properties: Property[];
  investments: Investment[];
  categories: typeof defaultCategories;
};

const money = (n: number, compact = false) => {
  if (!compact) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency", currency: "INR", maximumFractionDigits: 0,
    }).format(n);
  }
  const sign = n < 0 ? "−" : "";
  const value = Math.abs(n);
  if (value >= 10_000_000) return `${sign}₹${(value / 10_000_000).toFixed(2)}Cr`;
  if (value >= 100_000) return `${sign}₹${(value / 100_000).toFixed(2)}L`;
  if (value >= 1_000) return `${sign}₹${(value / 1_000).toFixed(1)}K`;
  return `${sign}₹${Math.round(value).toLocaleString("en-IN")}`;
};

const seedIncome: Entry[] = [];
const seedSpending: Entry[] = [];
const seedProperties: Property[] = [];
const seedInvestments: Investment[] = [];

const annual = (e: Entry) => e.amount * ({ "One-time": 1, Monthly: 12, "Bi-monthly": 6, Quarterly: 4, "Half-yearly": 2, Yearly: 1 }[e.frequency]);
const monthly = (e: Entry) => annual(e) / 12;
const palette = ["#7658ff", "#14b8a6", "#ff9d4d", "#ec5b83", "#43a6ff", "#f5c84c", "#7dd87d", "#9a74ff"];
const defaultCategories = {
  income: ["Salary", "Rent", "Interest from FD"],
  home: ["Gas Bill","Electricity Bill","Home Maintenance","Grocery","Petrol","Hotel & Restaurant","Internet Bill","Car Cleaning","Car Maintenance"],
  property: ["Property Electricity","Municipal Tax","Maintenance","Renovation","Water Bill","Property Gas Bill"],
  school: ["Fees","Trips","Stationery","Uniform","School Other"],
  investment: ["EPF","LIC Pension Plus","Sovereign Gold Bond","Physical Gold","Silver","Stocks","Mutual Funds","Foreign Currency","Current Balance / FD"],
  propertyType: ["Self occupied","Investment","Commercial","Residential rental"],
};

function Donut({ data, centre }: { data: { label: string; value: number }[]; centre: string }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const gradient = data.reduce<{ parts: string[]; offset: number }>((acc, d, i) => {
    const end = acc.offset + Math.max(0, d.value) / total * 100;
    return { parts: [...acc.parts, `${palette[i % palette.length]} ${acc.offset}% ${end}%`], offset: end };
  }, { parts: [], offset: 0 }).parts.join(", ");
  return <div className="donut-wrap">
    <div className="donut" style={{ background: `conic-gradient(${gradient})` }}><div><strong>{centre}</strong><span>total</span></div></div>
    <div className="legend">{data.filter(d => d.value > 0).map((d, i) => <div key={d.label}><i style={{ background: palette[i % palette.length] }} /><span>{d.label}</span><b>{money(d.value, true)}</b></div>)}</div>
  </div>;
}

function MiniLine({ points, color = "#7658ff" }: { points: number[]; color?: string }) {
  const max = Math.max(...points), min = Math.min(...points), range = max - min || 1;
  const coords = points.map((p, i) => `${i * 100 / (points.length - 1)},${64 - ((p - min) / range) * 54}`).join(" ");
  return <svg className="spark" viewBox="0 0 100 70" preserveAspectRatio="none" aria-label="trend chart">
    <polyline points={coords} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export default function Home() {
  const [view, setView] = useState<View>("Overview");
  const [income, setIncome] = useState<Entry[]>(seedIncome);
  const [spending, setSpending] = useState<Entry[]>(seedSpending);
  const [properties, setProperties] = useState<Property[]>(seedProperties);
  const [investments, setInvestments] = useState<Investment[]>(seedInvestments);
  const [hydrated, setHydrated] = useState(false);
  const [openProperty, setOpenProperty] = useState<number | null>(null);
  const [period, setPeriod] = useState<"Month" | "Year">("Month");
  const [month, setMonth] = useState("July");
  const [year, setYear] = useState("2026");
  const [expenseSection, setExpenseSection] = useState<"Home" | "Property" | "School">("Home");
  const [retireAge, setRetireAge] = useState(60);
  const [retireExpense, setRetireExpense] = useState(125000);
  const [inflation, setInflation] = useState(6);
  const [marketQuotes, setMarketQuotes] = useState<MarketQuote[]>([]);
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [categories, setCategories] = useState(defaultCategories);
  const [saveStatus, setSaveStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const applyState = (d: Partial<FinanceState>) => {
      setIncome(d.income || seedIncome);
      setSpending(d.spending || seedSpending);
      setProperties((d.properties || seedProperties).map((p: Property) => ({
        ...p,
        cost: p.cost ?? p.value ?? 0,
        value: p.value ?? p.cost ?? 0,
      })));
      setInvestments((d.investments || seedInvestments).map((i: Investment) => ({
        ...i,
        amount: i.amount ?? i.value ?? 0,
      })));
      setCategories(d.categories || defaultCategories);
    };
    const load = async () => {
      let local: Partial<FinanceState> | null = null;
      try {
        local = JSON.parse(localStorage.getItem("finance-cache-" + window.sessionStorage.getItem("finance-user")) || "null");
      } catch {}
      try {
        const response = await financeFetch("/api/finance", { cache: "no-store" });
        if (!response.ok) throw new Error("load failed");
        const data = await response.json();
        if (!active) return;
        if (data.state) {
          applyState(data.state);
          setSavedAt(data.updatedAt || null);
          setSaveStatus("saved");
        } else {
          const initial = local || { income: seedIncome, spending: seedSpending, properties: seedProperties, investments: seedInvestments, categories: defaultCategories };
          applyState(initial);
          const saved = await financeFetch("/api/finance", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: initial }),
          });
          if (!saved.ok) throw new Error("migration failed");
          const result = await saved.json();
          setSavedAt(result.updatedAt || null);
          setSaveStatus("saved");
        }
      } catch {
        if (local) applyState(local);
        setSaveStatus("error");
      } finally {
        if (active && financeFetch.loaded) setHydrated(true);
      }
    };
    load();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const state = { income, spending, properties, investments, categories };
    localStorage.setItem("finance-cache-" + window.sessionStorage.getItem("finance-user"), JSON.stringify(state));
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const response = await financeFetch("/api/finance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("save failed");
        const result = await response.json();
        setSavedAt(result.updatedAt || null);
        setSaveStatus("saved");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSaveStatus("error");
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hydrated, income, spending, properties, investments, categories]);
  useEffect(() => {
    let active = true;
    const loadMarket = async () => {
      try {
        const response = await financeFetch("/api/market", { cache: "no-store" });
        if (!response.ok) throw new Error("Quote service unavailable");
        const data = await response.json();
        if (!active) return;
        setMarketQuotes(data.quotes || []);
        setMarketOpen(Boolean(data.marketOpen));
        setMarketUpdatedAt(data.updatedAt || null);
        setMarketError("");
      } catch {
        if (active) setMarketError("Live prices are temporarily unavailable.");
      } finally {
        if (active) setMarketLoading(false);
      }
    };
    loadMarket();
    const timer = window.setInterval(loadMarket, marketOpen ? 60_000 : 5 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [marketOpen]);

  const metrics = useMemo(() => {
    const monthlyIncome = income.filter(e => e.active).reduce((s, e) => s + monthly(e), 0);
    const monthlySpend = spending.filter(e => e.active).reduce((s, e) => s + monthly(e), 0);
    const propertyValue = properties.filter(p => p.type !== "Self occupied").reduce((s, p) => s + p.value, 0);
    const investmentValue = investments.reduce((s, i) => s + i.value, 0);
    const debt = properties.reduce((s, p) => s + p.pending, 0);
    const netWorth = propertyValue + investmentValue - debt;
    return { monthlyIncome, monthlySpend, propertyValue, investmentValue, debt, netWorth, surplus: monthlyIncome - monthlySpend };
  }, [income, spending, properties, investments]);

  const updateEntry = (kind: "income" | "spending", id: number, key: keyof Entry, value: string | number | boolean) => {
    const fn = kind === "income" ? setIncome : setSpending;
    fn(rows => rows.map(r => r.id === id ? { ...r, [key]: value } : r));
  };
  const addEntry = (kind: "income" | "spending", category = "Grocery") => {
    const row: Entry = { id: Date.now(), name: "New entry", category: kind === "income" ? "Salary" : category, amount: 0, frequency: "Monthly", active: true };
    if (kind === "income") setIncome(r => [...r, row]);
    else setSpending(r => [...r, row]);
  };

  const periodFactor = period === "Year" ? 12 : 1;
  const shown = {
    income: metrics.monthlyIncome * periodFactor,
    spend: metrics.monthlySpend * periodFactor,
    surplus: metrics.surplus * periodFactor,
  };
  const assetData = [
    { label: "Properties", value: metrics.propertyValue },
    { label: "EPF & pension", value: investments.slice(0, 2).reduce((s, i) => s + i.value, 0) },
    { label: "Gold & silver", value: investments.slice(2, 5).reduce((s, i) => s + i.value, 0) },
    { label: "Market & currency", value: investments.slice(5).reduce((s, i) => s + i.value, 0) },
  ];
  const propertyCats = categories.property;
  const homeCats = categories.home;
  const schoolCats = categories.school;
  const expenseData = [
    { label: "Home", value: spending.filter(e => homeCats.includes(e.category) && e.active).reduce((s, e) => s + monthly(e), 0) * periodFactor },
    { label: "Property", value: spending.filter(e => propertyCats.includes(e.category) && e.active).reduce((s, e) => s + monthly(e), 0) * periodFactor },
    { label: "School", value: spending.filter(e => schoolCats.includes(e.category) && e.active).reduce((s, e) => s + monthly(e), 0) * periodFactor },
  ];
  const expenseSectionTotals = {
    Home: spending.filter(e => homeCats.includes(e.category) && e.active).reduce((s, e) => s + monthly(e), 0),
    Property: spending.filter(e => propertyCats.includes(e.category) && e.active).reduce((s, e) => s + monthly(e), 0),
    School: spending.filter(e => schoolCats.includes(e.category) && e.active).reduce((s, e) => s + monthly(e), 0),
  };
  const incomeData = categories.income.map(c => ({ label: c, value: income.filter(e => e.category === c && e.active).reduce((s, e) => s + monthly(e), 0) * periodFactor }));
  const yearsToRetire = Math.max(0, retireAge - 40);
  const expenseAtRetire = retireExpense * Math.pow(1 + inflation / 100, yearsToRetire);
  const corpusNeed = expenseAtRetire * 12 * 25;
  const projectedNet = metrics.netWorth * Math.pow(1.085, yearsToRetire);
  const funding = projectedNet / corpusNeed * 100;
  const nav: { name: View; label: string; icon: string }[] = [
    { name: "Monthly Records", label: "Monthly Records", icon: "📅" },
    { name: "Overview", label: "Planning Dashboard", icon: "🏠" },
    { name: "Income", label: "Income", icon: "🪙" },
    { name: "Expenses", label: "Expenses", icon: "🛍️" },
    { name: "Investments", label: "Investments", icon: "🌱" },
    { name: "Scenario Calculation", label: "Scenario Calculation", icon: "🚀" },
    { name: "Settings", label: "Settings", icon: "⚙️" },
  ];

  return <main className="app-shell">
    <aside><button onClick={() => supabase.auth.signOut()}>Sign out</button>
      <div className="brand"><div>ND</div><span><b>WealthLens</b><small>Private wealth intelligence</small></span></div>
      <nav>{nav.map(n => <button key={n.name} className={view === n.name ? "active" : ""} onClick={() => setView(n.name)}><i>{n.icon}</i>{n.label}</button>)}</nav>
      <div className="profile"><div>ND</div><span><b>Nilesh Darji</b><small className={`save-state ${saveStatus}`}>{saveStatus === "loading" ? "Loading saved data…" : saveStatus === "saving" ? "Saving permanently…" : saveStatus === "error" ? "Save failed · reload before editing" : `Saved permanently${savedAt ? ` · ${new Date(savedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}`}</small></span></div>
    </aside>

    <section className="workspace">
      <header>
        <div><small>HOUSEHOLD WEALTH MANAGEMENT</small><h1>{view === "Overview" ? "Dashboard" : view}</h1><p>{view === "Overview" ? "Your complete financial position, cash flow, priorities and portfolio at a glance." : view === "Scenario Calculation" ? "Test every investment and retirement assumption against your current position." : "Maintain the source data here; every analysis and forecast updates automatically."}</p></div>
        {view !== "Settings" && <div className="period"><button className={period === "Month" ? "selected" : ""} onClick={() => setPeriod("Month")}>Month</button><button className={period === "Year" ? "selected" : ""} onClick={() => setPeriod("Year")}>Year</button>{period === "Month" && <select value={month} onChange={e => setMonth(e.target.value)}>{["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => <option key={m}>{m}</option>)}</select>}<select value={year} onChange={e => setYear(e.target.value)}>{["2026","2027","2028","2029","2030"].map(y => <option key={y}>{y}</option>)}</select></div>}
      </header>

      {view === "Monthly Records" && <MonthlyRecords />}
      {view === "Overview" && <>
        <div className="kpis">
          <article className="purple clickable" onClick={()=>setView("Income")}><span>Income <em>Open tab →</em></span><strong>{money(shown.income, true)}</strong><small>{period === "Year" ? `${year} annualised income` : `${month} monthly income`}</small><MiniLine points={[72,74,73,78,81,85,88]} /></article>
          <article className="green clickable" onClick={()=>setView("Expenses")}><span>Expenses <em>Open tab →</em></span><strong>{money(shown.spend, true)}</strong><small>Home, property and school spending</small><MiniLine points={[52,58,55,60,64,66,68]} color="#0f9f8f" /></article>
          <article className="orange clickable" onClick={()=>setView("Investments")}><span>Investments <em>Open tab →</em></span><strong>{money(metrics.netWorth, true)}</strong><small>Net invested wealth after pending payments</small><MiniLine points={[25,25,51,51,51,76,76]} color="#e68027" /></article>
          <article className="blue clickable" onClick={()=>setView("Scenario Calculation")}><span>Scenario calculation <em>Model future →</em></span><strong>{money(shown.surplus, true)}</strong><small>{period === "Year" ? "Annual investible surplus" : "Monthly investible surplus"}</small><MiniLine points={[33,33,31,27,22,15,8]} color="#2587dc" /></article>
        </div>

        <article className="card market-card">
          <div className="market-heading">
            <div className="card-title"><span><small>LIVE BSE WATCHLIST</small><h2>Indian stock market</h2></span></div>
            <div className="market-meta">
              <span className={`market-status ${marketOpen ? "open" : "closed"}`}><i />{marketOpen ? "BSE open" : "BSE closed"}</span>
              <span>{marketUpdatedAt ? `Updated ${new Date(marketUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST` : "Connecting…"}</span>
            </div>
          </div>
          {marketError && <p className="market-error">{marketError} The panel will retry automatically.</p>}
          <div className="market-list" aria-live="polite">
            {marketLoading && !marketQuotes.length
              ? Array.from({ length: 7 }, (_, i) => <div className="market-row loading" key={i}><span /><b /><small /></div>)
              : marketQuotes.map(q => {
                  const positive = (q.change || 0) >= 0;
                  return <div className="market-row" key={q.code}>
                    <div><span>{q.name}</span><small>BSE · {q.code}</small></div>
                    <strong>{q.price == null ? "—" : money(q.price)}</strong>
                    <em className={positive ? "gain" : "loss"}>
                      {q.change == null ? "Quote unavailable" : `${positive ? "▲" : "▼"} ${Math.abs(q.change).toFixed(2)} (${Math.abs(q.changePercent || 0).toFixed(2)}%)`}
                    </em>
                  </div>;
                })}
          </div>
          <footer><span>Prices may be delayed. For monitoring only—not an exchange trading feed.</span><button onClick={() => { setMarketLoading(true); financeFetch("/api/market", { cache: "no-store" }).then(r => r.json()).then(data => { setMarketQuotes(data.quotes || []); setMarketOpen(Boolean(data.marketOpen)); setMarketUpdatedAt(data.updatedAt || null); setMarketError(""); }).catch(() => setMarketError("Live prices are temporarily unavailable.")).finally(() => setMarketLoading(false)); }}>Refresh prices ↻</button></footer>
        </article>

        <div className="insight-row">
          <article className="card cash-card"><div className="card-title"><span><small>CASH FLOW</small><h2>{period === "Month" ? month : year} overview</h2></span><b className="good">Positive</b></div>
            <div className="cash-bars">
              <div><span>Income <b>{money(shown.income)}</b></span><i><em style={{width:"100%"}} /></i></div>
              <div><span>Expenses <b>{money(shown.spend)}</b></span><i><em className="expense" style={{width:`${Math.min(100,shown.spend/Math.max(1,shown.income)*100)}%`}} /></i></div>
              <div><span>Available to invest <b>{money(shown.surplus)}</b></span><i><em className="surplus" style={{width:`${Math.min(100,shown.surplus/Math.max(1,shown.income)*100)}%`}} /></i></div>
            </div>
          </article>
          <article className="card analyst"><div className="card-title"><span><small>ANALYST VIEW</small><h2>Priorities this month</h2></span></div>
            <ul><li className="warn clickable" onClick={()=>setView("Investments")}><i>1</i><span><b>Prepare GIFT City funding plan</b><small>₹33 lakh starts from Jan 2027. Keep EMI reserve liquid. Open →</small></span></li>
              <li className="info clickable" onClick={()=>setView("Investments")}><i>2</i><span><b>Property concentration is high</b><small>{Math.round(metrics.propertyValue/Math.max(1,metrics.propertyValue+metrics.investmentValue)*100)}% of gross assets are in property. Review allocation →</small></span></li>
              <li className="goodli clickable" onClick={()=>setView("Scenario Calculation")}><i>3</i><span><b>Cash-flow buffer is strong</b><small>Current surplus covers {Math.floor(metrics.surplus/metrics.monthlySpend)} month(s) of expenses monthly. Test a scenario →</small></span></li></ul>
          </article>
        </div>

        <div className="charts-row">
          <article className="card"><div className="card-title"><span><small>ALLOCATION</small><h2>Where your wealth sits</h2></span><button onClick={()=>setView("Investments")}>View details →</button></div><Donut data={assetData} centre={money(metrics.propertyValue+metrics.investmentValue,true)} /></article>
          <article className="card"><div className="card-title"><span><small>SPENDING</small><h2>{period === "Year" ? "Annual" : "Monthly"} expense mix</h2></span><button onClick={()=>setView("Expenses")}>Manage →</button></div><Donut data={expenseData} centre={money(shown.spend,true)} /></article>
          <article className="card"><div className="card-title"><span><small>INCOME</small><h2>{period === "Year" ? "Annual" : "Monthly"} income mix</h2></span><button onClick={()=>setView("Income")}>Manage →</button></div><Donut data={incomeData} centre={money(shown.income,true)} /></article>
        </div>
      </>}

      {view === "Income" && <section className="section-stack">
        <div className="summary-strip">
          <article><span>Monthly income</span><strong>{money(metrics.monthlyIncome,true)}</strong></article>
          <article><span>Annualised income</span><strong>{money(metrics.monthlyIncome*12,true)}</strong></article>
          <article><span>Monthly surplus</span><strong>{money(metrics.surplus,true)}</strong></article>
        </div>
        <Ledger title="Income" rows={income} categories={categories.income} onChange={(id,key,value)=>updateEntry("income",id,key,value)} onAdd={()=>addEntry("income")} onDelete={id=>setIncome(r=>r.filter(x=>x.id!==id))} />
      </section>}
      {view === "Expenses" && <section className="section-stack">
        <div className="major-tabs expense-tabs">{(["Home","Property","School"] as const).map(section=><button key={section} className={expenseSection===section?"active":""} onClick={()=>setExpenseSection(section)}><span>{section} expenses</span><b>{money(expenseSectionTotals[section],true)} / month</b></button>)}</div>
        <div className="summary-strip">
          <article><span>Monthly expenses</span><strong>{money(metrics.monthlySpend,true)}</strong></article>
          <article><span>Annualised expenses</span><strong>{money(metrics.monthlySpend*12,true)}</strong></article>
          <article><span>Monthly surplus</span><strong>{money(metrics.surplus,true)}</strong></article>
        </div>
        <StatementImporter
          categories={[...homeCats, ...propertyCats, ...schoolCats]}
          existing={spending}
          onImport={(rows) => setSpending(current => [...current, ...rows])}
        />
        {expenseSection==="Home"&&<Ledger title="Home Expenses" rows={spending.filter(r=>homeCats.includes(r.category))} categories={homeCats} onChange={(id,key,value)=>updateEntry("spending",id,key,value)} onAdd={()=>addEntry("spending",homeCats[0])} onDelete={id=>setSpending(r=>r.filter(x=>x.id!==id))}/>}
        {expenseSection==="Property"&&<Ledger title="Property Running Expenses" rows={spending.filter(r=>propertyCats.includes(r.category))} categories={propertyCats} onChange={(id,key,value)=>updateEntry("spending",id,key,value)} onAdd={()=>addEntry("spending",propertyCats[0])} onDelete={id=>setSpending(r=>r.filter(x=>x.id!==id))}/>}
        {expenseSection==="School"&&<Ledger title="School Expenses" rows={spending.filter(r=>schoolCats.includes(r.category))} categories={schoolCats} onChange={(id,key,value)=>updateEntry("spending",id,key,value)} onAdd={()=>addEntry("spending",schoolCats[0])} onDelete={id=>setSpending(r=>r.filter(x=>x.id!==id))}/>}
        <article className="card compact-chart"><div className="card-title"><span><small>TOTAL EXPENSES</small><h2>Home, property and school cost mix</h2></span></div><Donut data={expenseData} centre={money(metrics.monthlySpend,true)}/></article>
      </section>}
      {view === "Property Costs" && <Ledger title="Property Costs" rows={spending.filter(r=>propertyCats.includes(r.category))} categories={propertyCats} onChange={(id,key,value)=>updateEntry("spending",id,key,value)} onAdd={()=>addEntry("spending",propertyCats[0])} onDelete={id=>setSpending(r=>r.filter(x=>x.id!==id))} />}
      {view === "Home Expenses" && <Ledger title="Home Expenses" rows={spending.filter(r=>homeCats.includes(r.category))} categories={homeCats} onChange={(id,key,value)=>updateEntry("spending",id,key,value)} onAdd={()=>addEntry("spending",homeCats[0])} onDelete={id=>setSpending(r=>r.filter(x=>x.id!==id))} />}
      {view === "School Expenses" && <Ledger title="School Expenses" rows={spending.filter(r=>schoolCats.includes(r.category))} categories={schoolCats} onChange={(id,key,value)=>updateEntry("spending",id,key,value)} onAdd={()=>addEntry("spending",schoolCats[0])} onDelete={id=>setSpending(r=>r.filter(x=>x.id!==id))} />}

      {view === "Properties" && <div className="page-grid">
        <section className="card wide"><div className="card-title"><span><small>PROPERTY REGISTER</small><h2>{properties.length} properties · {money(metrics.propertyValue,true)} current value</h2></span><button className="primary" onClick={()=>setProperties(p=>[...p,{id:Date.now(),name:"New property",type:"Investment",cost:0,value:0,rent:0,rentStart:"",pending:0,address:"",electricityProvider:"",electricityId:"",gasProvider:"",gasId:"",taxId:""}])}>+ Add property</button></div>
          <div className="property-list">{properties.map(p=><div className={`property ${openProperty===p.id?"open":""}`} key={p.id}>
            <button className="property-head" onClick={()=>setOpenProperty(openProperty===p.id?null:p.id)}><span><i>⌂</i><b>{p.name}</b><small>{p.type}</small></span><span><b>{money(p.value,true)}</b><small>{p.rent ? `${money(p.rent)}/month rent` : "Self occupied"}</small></span><em>{openProperty===p.id?"−":"+"}</em></button>
            {openProperty===p.id&&<div className="property-details">
              {(["name","type","value","rent","rentStart","pending","address","electricityProvider","electricityId","gasProvider","gasId","taxId"] as (keyof Property)[]).map(k=><label key={k}><span>{({rentStart:"Rent start",pending:"Amount pending",electricityProvider:"Electricity provider",electricityId:"Electricity customer ID",gasProvider:"Gas provider",gasId:"Gas customer ID",taxId:"Property tax ID"} as Record<string,string>)[k]||k[0].toUpperCase()+k.slice(1)}</span>{k==="type"?<select value={p.type} onChange={e=>setProperties(rows=>rows.map(x=>x.id===p.id?{...x,type:e.target.value}:x))}>{categories.propertyType.map(v=><option key={v}>{v}</option>)}</select>:<input type={typeof p[k]==="number"?"number":k==="rentStart"?"month":"text"} value={p[k]} onChange={e=>setProperties(rows=>rows.map(x=>x.id===p.id?{...x,[k]:typeof p[k]==="number"?Number(e.target.value):e.target.value}:x))}/>}</label>)}
              <div className="property-actions"><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`} target="_blank">Open address in Maps</a><button className="danger" onClick={()=>setProperties(rows=>rows.filter(x=>x.id!==p.id))}>Delete property</button></div>
            </div>}
          </div>)}</div>
        </section>
        <aside className="card property-analysis"><small>PORTFOLIO ANALYSIS</small><h2>Property performance</h2>{properties.map(p=>{const annualRent=p.rent*12;const yieldPct=p.value?annualRent/p.value*100:0;return <div key={p.id}><span><b>{p.name}</b><small>{p.type}</small></span><strong>{yieldPct.toFixed(1)}%<small>gross yield</small></strong></div>})}<p><b>Analyst note</b> Solaris currently has the strongest stated yield. GIFT City rent begins in 2029, so near-term cash flow should not count it.</p></aside>
      </div>}

      {view === "Investments" && <section className="investments-page">
        <div className="investment-wealth-hero">
          <span><small>NET INVESTED WEALTH</small><strong>{money(metrics.netWorth,true)}</strong><p>Investment assets after pending payments; self-occupied Adani Meadows excluded</p></span>
          <div>
            <span><small>Investment properties</small><b>{money(metrics.propertyValue,true)}</b></span>
            <i>+</i>
            <span><small>Other investments</small><b>{money(metrics.investmentValue,true)}</b></span>
            <i>−</i>
            <span><small>Pending payments</small><b>{money(metrics.debt,true)}</b></span>
          </div>
        </div>
        <div className="wealth-reconciliation">
          <span>Calculation check</span>
          <b>{money(metrics.propertyValue,true)} + {money(metrics.investmentValue,true)} − {money(metrics.debt,true)} = {money(metrics.netWorth,true)}</b>
          <small>GIFT City, Solaris and Vrundavan Heights are included. Adani Meadows is classified as the family home and excluded from investment value.</small>
        </div>
        <div className="page-grid">
          <section className="card wide"><div className="card-title"><span><small>PROPERTY INVESTMENTS</small><h2>Cost, income and current market value</h2></span><button className="primary" onClick={()=>setProperties(p=>[...p,{id:Date.now(),name:"New property",type:"Investment",cost:0,value:0,rent:0,rentStart:"",pending:0,address:"",electricityProvider:"",electricityId:"",gasProvider:"",gasId:"",taxId:""}])}>+ Add property</button></div>
            <div className="property-column-head"><span>Property</span><span>Purchase cost</span><span>Rental income</span><span>Current value</span><span /></div>
            <div className="property-list">{properties.map(p=><div className={`property ${openProperty===p.id?"open":""}`} key={p.id}>
              <button className="property-head property-financial-head" onClick={()=>setOpenProperty(openProperty===p.id?null:p.id)}>
                <span><i>⌂</i><b>{p.name}</b><small>{p.type==="Self occupied"?"Family home · excluded from investment":p.type}</small></span>
                <span className="property-metric"><small>Cost</small><b>{money(p.cost,true)}</b></span>
                <span className="property-metric"><small>Income</small><b>{p.rent?`${money(p.rent,true)}/mo`:"—"}</b></span>
                <span className="property-metric"><small>Current value</small><b>{p.type==="Self occupied"?"Excluded":money(p.value,true)}</b></span>
                <em>{openProperty===p.id?"−":"+"}</em>
              </button>
              {openProperty===p.id&&<div className="property-details">
                {(["name","type","cost","value","rent","rentStart","pending","address","electricityProvider","electricityId","gasProvider","gasId","taxId"] as (keyof Property)[]).map(k=><label key={k}><span>{({cost:"Purchase cost",value:"Current market value",rent:"Monthly rental income",rentStart:"Rent start",pending:"Amount pending",electricityProvider:"Electricity provider",electricityId:"Electricity customer ID",gasProvider:"Gas provider",gasId:"Gas customer ID",taxId:"Property tax ID"} as Record<string,string>)[k]||k[0].toUpperCase()+k.slice(1)}</span>{k==="type"?<select value={p.type} onChange={e=>setProperties(rows=>rows.map(x=>x.id===p.id?{...x,type:e.target.value}:x))}>{categories.propertyType.map(v=><option key={v}>{v}</option>)}</select>:<input type={typeof p[k]==="number"?"number":k==="rentStart"?"month":"text"} value={p[k]} onChange={e=>setProperties(rows=>rows.map(x=>x.id===p.id?{...x,[k]:typeof p[k]==="number"?Number(e.target.value):e.target.value}:x))}/>}</label>)}
                <div className="property-actions"><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`} target="_blank">Open address in Maps</a><button className="danger" onClick={()=>setProperties(rows=>rows.filter(x=>x.id!==p.id))}>Delete property</button></div>
              </div>}
            </div>)}</div>
          </section>
          <aside className="card property-analysis"><small>PROPERTY CLASSIFICATION</small><h2>Invested versus self-used</h2>{properties.map(p=><div key={p.id}><span><b>{p.name}</b><small>{p.type}</small></span><strong>{p.type==="Self occupied"?"Excluded":money(p.value,true)}<small>{p.type==="Self occupied"?"expense-only home":"investment value"}</small></strong></div>)}<p><b>Classification rule</b> Property purchase value is an investment only when the property is held as an investment. Adani running costs remain under Expenses.</p></aside>
        </div>
        <section className="card wide"><div className="card-title"><span><small>OTHER INVESTMENTS</small><h2>Editable return assumptions & contributions</h2></span><span className="title-actions"><b className="investment-subtotal">{money(metrics.investmentValue,true)} <small>other investments subtotal</small></b><button className="primary" onClick={()=>setInvestments(rows=>[...rows,{id:Date.now(),name:"New investment",amount:0,value:0,addition:0,frequency:"Monthly",startMonth:"2026-07",base:8,low:3,high:12}])}>+ Add investment</button></span></div>
        <div className="investment-table"><div className="thead"><span>Investment type</span><span>Investment amount</span><span>Current value</span><span>Auto addition</span><span>Start month</span><span>Frequency</span><span>Base return</span><span>Range</span><span>ROI</span></div>
          {investments.map(inv=>{const roi=inv.amount>0?(inv.value-inv.amount)/inv.amount*100:null;const types=categories.investment.includes(inv.name)?categories.investment:[inv.name,...categories.investment];return <div className="trow" key={inv.id}><select value={inv.name} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,name:e.target.value}:x))}>{types.map(v=><option key={v}>{v}</option>)}</select><input type="number" value={inv.amount} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,amount:Number(e.target.value)}:x))}/><input type="number" value={inv.value} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,value:Number(e.target.value)}:x))}/><input type="number" value={inv.addition} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,addition:Number(e.target.value)}:x))}/><input type="month" value={inv.startMonth||"2026-07"} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,startMonth:e.target.value}:x))}/><select value={inv.frequency} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,frequency:e.target.value as Frequency}:x))}><option>Monthly</option><option>Quarterly</option><option>Yearly</option></select><label className="rate"><input type="number" value={inv.base} onChange={e=>setInvestments(rows=>rows.map(x=>x.id===inv.id?{...x,base:Number(e.target.value)}:x))}/><i>%</i></label><span className="range">{inv.low}% — {inv.high}%</span><strong className={`roi ${roi!==null&&roi<0?"negative":""}`}>{roi===null?"—":`${roi>=0?"+":""}${roi.toFixed(1)}%`}</strong></div>})}
        </div></section>
      </section>}

      {view === "Forecast" && <Forecast investments={investments} properties={properties} monthlyIncome={metrics.monthlyIncome} monthlySpend={metrics.monthlySpend} debt={metrics.debt} />}
      {view === "Scenario Calculation" && <Forecast investments={investments} properties={properties.filter(p=>p.type!=="Self occupied")} monthlyIncome={metrics.monthlyIncome} monthlySpend={metrics.monthlySpend} debt={metrics.debt} />}

      {view === "Settings" && <MasterData categories={categories} onChange={setCategories} />}

      {view === "Retirement" && <section className="retirement">
        <div className="retire-hero"><span><small>RETIREMENT READINESS</small><h2>{funding >= 100 ? "You are on track." : "Your plan needs a stronger bridge."}</h2><p>Projected funding at age {retireAge}</p></span><strong>{Math.round(funding)}<i>%</i></strong></div>
        <div className="retire-grid"><article className="card assumptions"><div className="card-title"><span><small>ASSUMPTIONS</small><h2>Make the model yours</h2></span></div>
          <label>Current age <input value={40} disabled /></label><label>Retirement age <input type="number" value={retireAge} onChange={e=>setRetireAge(Number(e.target.value))}/></label><label>Current monthly retirement lifestyle <input type="number" value={retireExpense} onChange={e=>setRetireExpense(Number(e.target.value))}/></label><label>Inflation <input type="number" value={inflation} onChange={e=>setInflation(Number(e.target.value))}/></label>
        </article><article className="card retire-table"><div className="card-title"><span><small>RETIREMENT MODEL</small><h2>Need vs projected resources</h2></span></div>
          <div><span>Years to retirement</span><b>{yearsToRetire} years</b></div><div><span>Monthly need today</span><b>{money(retireExpense)}</b></div><div><span>Inflation-adjusted monthly need</span><b>{money(expenseAtRetire)}</b></div><div><span>Required corpus (25× annual expense)</span><b>{money(corpusNeed,true)}</b></div><div><span>Projected net worth</span><b>{money(projectedNet,true)}</b></div><div className={projectedNet>=corpusNeed?"positive":"negative"}><span>Projected surplus / shortfall</span><b>{money(projectedNet-corpusNeed,true)}</b></div>
        </article></div>
        <article className="card retirement-income"><div className="card-title"><span><small>INCOME AT RETIREMENT</small><h2>Property income included transparently</h2></span></div>
          <div className="income-table"><span>Property</span><span>Rent starts</span><span>Rent today</span><span>At retirement*</span>{properties.filter(p=>p.rent>0).map(p=><><b key={p.id+"n"}>{p.name}</b><span key={p.id+"s"}>{p.rentStart||"Now"}</span><span key={p.id+"r"}>{money(p.rent)}</span><strong key={p.id+"f"}>{money(p.rent*Math.pow(1.05,yearsToRetire))}</strong></>)}</div><small>*Assumes 5% yearly rent increase. Values remain editable in Properties.</small>
        </article>
      </section>}

      {view === "Data Quality" && <section className="quality-grid">
        <article className="quality-hero"><span><small>CONTROL & ASSURANCE</small><h2>Financial data quality</h2><p>Review missing identifiers, inactive future income and assumptions that need confirmation.</p></span><strong>{properties.filter(p=>p.address&&p.taxId&&p.electricityId).length}/{properties.length}<small>complete properties</small></strong></article>
        <article className="card"><div className="card-title"><span><small>OPEN ITEMS</small><h2>Items requiring review</h2></span></div>
          <ul className="check-list">
            {properties.filter(p=>!p.taxId||!p.electricityId||!p.gasId).map(p=><li key={p.id}><i>!</i><span><b>{p.name}</b><small>{[!p.taxId&&"property-tax ID",!p.electricityId&&"electricity customer ID",!p.gasId&&"gas customer ID"].filter(Boolean).join(", ")} missing</small></span></li>)}
            <li><i>!</i><span><b>GIFT City rent is future-dated</b><small>₹25,000/month starts in January 2029 and is excluded before then.</small></span></li>
            <li><i>i</i><span><b>Foreign currency is INR-normalised</b><small>Update the INR equivalent when the exchange rate or holding changes.</small></span></li>
          </ul>
        </article>
        <article className="card governance"><div className="card-title"><span><small>MODEL GOVERNANCE</small><h2>Calculation standards</h2></span></div>
          <div><span>Property purchase price</span><b>Asset value—not an expense</b></div><div><span>Property running costs</span><b>Cash-flow expense</b></div><div><span>Recurring entries</span><b>Normalised by frequency</b></div><div><span>Forecasts</span><b>Asset-specific downside / base / upside</b></div><div><span>Retirement</span><b>Inflation-adjusted need and rent</b></div>
        </article>
      </section>}
    </section>
  </main>;
}

function StatementImporter({ categories, existing, onImport }: { categories: string[]; existing: Entry[]; onImport: (rows: Entry[]) => void }) {
  const [rows, setRows] = useState<ImportedTransaction[]>([]);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const readSpreadsheet = async (file: File) => {
    setBusy(true);
    setStatus("Reading Excel statement…");
    setFileName(file.name);
    setRows([]);
    try {
      if (file.size > 20 * 1024 * 1024) {
        setStatus("This file is larger than 20 MB. Please download a shorter statement period and try again.");
        return;
      }
      const result = parseExcelStatement(await file.arrayBuffer(), categories, existing);
      setRows(result.rows);
      if (result.rows.length) {
        setStatus(`${result.rows.length} debit/withdrawal transactions found in ${result.matchedSheets} statement sheet${result.matchedSheets === 1 ? "" : "s"}. ${result.skippedCredits} credit/deposit row${result.skippedCredits === 1 ? " was" : "s were"} excluded.`);
      } else if (!result.matchedSheets) {
        setStatus("The workbook opened, but no statement table was found. It must include Transaction Date, Remarks/Narration and Withdrawal/Debit Amount columns.");
      } else {
        setStatus("The statement table was found, but it contains no debit/withdrawal transactions. Credit/deposit and balance values were excluded.");
      }
    } catch {
      setRows([]);
      setStatus("This Excel file could not be read. Please download the original .xlsx, .xls or .csv statement from ICICI and upload it without changing its column headings.");
    } finally {
      setBusy(false);
    }
  };

  const importSelected = () => {
    const selected = rows.filter(row => row.selected && !row.duplicate);
    onImport(selected.map((row, index) => ({
      id: Date.now() + index,
      name: row.description,
      category: row.category,
      amount: row.amount,
      frequency: "One-time",
      active: true,
      date: row.date,
      source: `Excel · ${fileName}`,
    })));
    setRows([]);
    setStatus(`${selected.length} expenses added. Dashboard, cash flow, scenarios and retirement figures are recalculated.`);
  };

  return <article className="card statement-import">
    <div className="statement-intro">
      <span><small>EXCEL STATEMENT IMPORT</small><h2>Upload → review → add to Expenses</h2><p>Download the bank statement as Excel, then upload the original .xlsx, .xls or .csv file. Only debit/withdrawal rows are imported; deposits and running balances are excluded.</p></span>
      <label className="upload-button"><input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" disabled={busy} onChange={e => {
        const file = e.currentTarget.files?.[0];
        if (file) void readSpreadsheet(file);
        e.currentTarget.value = "";
      }}/>{busy ? "Reading…" : "Upload Excel"}</label>
    </div>
    {status && <div className="import-status">{status}</div>}
    {rows.length > 0 && <>
      <div className="import-toolbar"><span><b>{rows.filter(r => r.selected && !r.duplicate).length}</b> selected · {rows.filter(r => r.duplicate).length} possible duplicates</span><button className="primary" disabled={!rows.some(r => r.selected && !r.duplicate)} onClick={importSelected}>Add selected expenses</button></div>
      <div className="import-table">
        <div className="import-head"><span>Use</span><span>Date & description</span><span>Category</span><span>Amount</span></div>
        {rows.map(row => <div className={`import-row ${row.duplicate ? "duplicate" : ""}`} key={row.id}>
          <input type="checkbox" checked={row.selected} disabled={row.duplicate} onChange={e => setRows(current => current.map(item => item.id === row.id ? { ...item, selected: e.target.checked } : item))}/>
          <span><b>{row.description}</b><small>{new Date(`${row.date}T00:00:00`).toLocaleDateString("en-IN")} · {row.duplicate ? "Possible duplicate" : fileName}</small></span>
          <select value={row.category} onChange={e => setRows(current => current.map(item => item.id === row.id ? { ...item, category: e.target.value } : item))}>{categories.map(category => <option key={category}>{category}</option>)}</select>
          <strong>{money(row.amount)}</strong>
        </div>)}
      </div>
    </>}
  </article>;
}

function Ledger({ title, rows, categories: cats, onChange, onAdd, onDelete }: {title:string;rows:Entry[];categories:string[];onChange:(id:number,key:keyof Entry,value:string|number|boolean)=>void;onAdd:()=>void;onDelete:(id:number)=>void}) {
  const [filter,setFilter]=useState("All");
  const visible=filter==="All"?rows:rows.filter(r=>r.category===filter);
  const selectedTotal=visible.filter(r=>r.active).reduce((s,e)=>s+monthly(e),0);
  return <section className="card wide"><div className="card-title"><span><small>{title.toUpperCase()} LEDGER</small><h2>Recurring and one-time planning</h2></span><button className="primary" onClick={onAdd}>+ Add entry</button></div>
    <div className="filters">{["All",...cats].map(c=><button key={c} className={filter===c?"selected":""} onClick={()=>setFilter(c)}>{c}</button>)}</div>
    <div className="ledger"><div className="ledger-head"><span>Entry</span><span>Category</span><span>Amount</span><span>Frequency</span><span>Active</span><span /></div>{visible.map(r=><div className="ledger-row" key={r.id}><input value={r.name} onChange={e=>onChange(r.id,"name",e.target.value)}/><select value={r.category} onChange={e=>onChange(r.id,"category",e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select><input type="number" value={r.amount} onChange={e=>onChange(r.id,"amount",Number(e.target.value))}/><select value={r.frequency} onChange={e=>onChange(r.id,"frequency",e.target.value as Frequency)}>{["One-time","Monthly","Bi-monthly","Quarterly","Half-yearly","Yearly"].map(f=><option key={f}>{f}</option>)}</select><input className="toggle" type="checkbox" checked={r.active} onChange={e=>onChange(r.id,"active",e.target.checked)}/><button className="icon-delete" onClick={()=>onDelete(r.id)}>×</button></div>)}</div>
    <div className="ledger-total"><span>{filter === "All" ? `${title} monthly total` : `${filter} monthly total`}</span><b>{money(selectedTotal)}</b></div></section>;
}

function MasterData({ categories, onChange }: { categories: typeof defaultCategories; onChange: (next: typeof defaultCategories) => void }) {
  const labels: Record<keyof typeof defaultCategories, string> = {
    income: "Income categories",
    home: "Home expense categories",
    property: "Property expense categories",
    school: "School expense categories",
    investment: "Investment types",
    propertyType: "Property classifications",
  };
  const add = (group: keyof typeof defaultCategories) => {
    const name = window.prompt(`New ${labels[group].toLowerCase().replace(/categories|types|classifications/, "category")}`);
    if (!name?.trim() || categories[group].some(x => x.toLowerCase() === name.trim().toLowerCase())) return;
    onChange({ ...categories, [group]: [...categories[group], name.trim()] });
  };
  const remove = (group: keyof typeof defaultCategories, name: string) =>
    onChange({ ...categories, [group]: categories[group].filter(x => x !== name) });
  return <section className="master-grid">
    <article className="master-intro">
      <span><small>SETTINGS</small><h2>Dropdown categories</h2><p>Add or remove the options used in the Income, Expense, Property and Investment dropdowns. Month and year controls do not apply to settings.</p></span>
      <strong>{Object.values(categories).flat().length}<small>active options</small></strong>
    </article>
    {(Object.keys(categories) as (keyof typeof defaultCategories)[]).map(group =>
      <article className="card master-card" key={group}>
        <div className="card-title"><span><small>AVAILABLE OPTIONS</small><h2>{labels[group]}</h2></span><button className="primary" onClick={() => add(group)}>+ Add</button></div>
        <div className="master-list">{categories[group].map(name => <div key={name}><span>{name}</span><button aria-label={`Remove ${name}`} onClick={() => remove(group, name)}>×</button></div>)}</div>
      </article>
    )}
  </section>;
}

function Forecast({investments,properties,monthlyIncome,monthlySpend,debt}:{investments:Investment[];properties:Property[];monthlyIncome:number;monthlySpend:number;debt:number}) {
  const [name,setName]=useState("Balanced growth plan");
  const [years,setYears]=useState(15);
  const [propertyGrowth,setPropertyGrowth]=useState(6);
  const [incomeGrowth,setIncomeGrowth]=useState(6);
  const [expenseInflation,setExpenseInflation]=useState(6);
  const [surplusInvested,setSurplusInvested]=useState(70);
  const [surplusReturn,setSurplusReturn]=useState(9);
  const [debtPaid,setDebtPaid]=useState(100);
  const [retireAge,setRetireAge]=useState(60);
  const [retireExpense,setRetireExpense]=useState(125000);
  const [retireInflation,setRetireInflation]=useState(6);
  const propertyTotal=properties.reduce((s,p)=>s+p.value,0);
  const investmentTotal=investments.reduce((s,i)=>s+i.value,0);
  const currentNet=propertyTotal+investmentTotal-debt;
  const contributionPeriods=(frequency:Frequency)=>frequency==="Monthly"?12:frequency==="Quarterly"?4:1;
  const calcInvestment=(inv:Investment,rate:number,horizon=years)=>{
    const periods=contributionPeriods(inv.frequency);
    const periodicRate=rate/100/periods;
    const n=horizon*periods;
    const futureCurrent=inv.value*Math.pow(1+rate/100,horizon);
    const futureAdds=inv.addition*(periodicRate ? (Math.pow(1+periodicRate,n)-1)/periodicRate : n);
    return futureCurrent+futureAdds;
  };
  const investmentFuture=investments.reduce((s,i)=>s+calcInvestment(i,i.base),0);
  const propertyFuture=propertyTotal*Math.pow(1+propertyGrowth/100,years);
  const annualSurplus=Math.max(0,(monthlyIncome-monthlySpend)*12*surplusInvested/100);
  const surplusRate=surplusReturn/100;
  const surplusFuture=annualSurplus*(surplusRate?(Math.pow(1+surplusRate,years)-1)/surplusRate:years);
  const remainingDebt=debt*(1-debtPaid/100);
  const scenarioNet=propertyFuture+investmentFuture+surplusFuture-remainingDebt;
  const baselineProperty=propertyTotal*Math.pow(1.06,years);
  const baselineInvestments=investments.reduce((s,i)=>s+calcInvestment(i,i.base),0);
  const baselineNet=baselineProperty+baselineInvestments-debt;
  const futureIncome=monthlyIncome*Math.pow(1+incomeGrowth/100,years);
  const futureExpense=monthlySpend*Math.pow(1+expenseInflation/100,years);
  const yearly=Array.from({length:years+1},(_,year)=>{
    const inv=investments.reduce((s,i)=>s+calcInvestment(i,i.base,year),0);
    const prop=propertyTotal*Math.pow(1+propertyGrowth/100,year);
    const added=annualSurplus*(surplusRate?(Math.pow(1+surplusRate,year)-1)/surplusRate:year);
    const debtLeft=debt*(1-(debtPaid/100)*(year/Math.max(1,years)));
    return {year:2026+year,value:prop+inv+added-debtLeft};
  });
  const linePoints=yearly.map(y=>y.value);
  const yearsToRetire=Math.max(0,retireAge-40);
  const expenseAtRetire=retireExpense*Math.pow(1+retireInflation/100,yearsToRetire);
  const retirementCorpus=expenseAtRetire*12*25;
  const retirementNet=yearly[Math.min(years,yearsToRetire)]?.value ?? scenarioNet;
  const retirementFunding=retirementCorpus?retirementNet/retirementCorpus*100:0;
  return <section className="forecast">
    <div className="forecast-top"><span><small>SCENARIO STUDIO</small><h2>Build and understand your forecast</h2><p>Create an editable plan, compare it with today’s baseline, and inspect how every component is calculated.</p></span><label>Scenario name<input value={name} onChange={e=>setName(e.target.value)} /></label></div>
    <div className="scenario-layout">
      <article className="card scenario-builder"><div className="card-title"><span><small>SCENARIO INPUTS</small><h2>{name}</h2></span><b className="live-pill">LIVE</b></div>
        <div className="scenario-inputs">
          <label>Forecast horizon <span><input type="number" min="1" max="40" value={years} onChange={e=>setYears(Math.max(1,Number(e.target.value)))}/><i>years</i></span></label>
          <label>Property appreciation <span><input type="number" step=".25" value={propertyGrowth} onChange={e=>setPropertyGrowth(Number(e.target.value))}/><i>% p.a.</i></span></label>
          <label>Income growth <span><input type="number" step=".25" value={incomeGrowth} onChange={e=>setIncomeGrowth(Number(e.target.value))}/><i>% p.a.</i></span></label>
          <label>Expense inflation <span><input type="number" step=".25" value={expenseInflation} onChange={e=>setExpenseInflation(Number(e.target.value))}/><i>% p.a.</i></span></label>
          <label>Current surplus invested <span><input type="number" min="0" max="100" value={surplusInvested} onChange={e=>setSurplusInvested(Number(e.target.value))}/><i>%</i></span></label>
          <label>New surplus return <span><input type="number" step=".25" value={surplusReturn} onChange={e=>setSurplusReturn(Number(e.target.value))}/><i>% p.a.</i></span></label>
          <label>Outstanding debt repaid <span><input type="number" min="0" max="100" value={debtPaid} onChange={e=>setDebtPaid(Number(e.target.value))}/><i>%</i></span></label>
        </div>
      </article>
      <article className="card scenario-result"><div className="card-title"><span><small>SCENARIO RESULT</small><h2>At the end of {years} years</h2></span></div>
        <strong>{money(scenarioNet,true)}</strong><p>Projected net worth in {2026+years}</p>
        <div className="comparison"><span>Current position <b>{money(currentNet,true)}</b></span><span>Standard baseline <b>{money(baselineNet,true)}</b></span><span className="selected">Your scenario <b>{money(scenarioNet,true)}</b></span></div>
        <div className="delta">Scenario vs baseline <b>{scenarioNet>=baselineNet?"+":""}{money(scenarioNet-baselineNet,true)}</b></div>
      </article>
    </div>
    <div className="scenario-cards"><article><span>Properties</span><b>{money(propertyFuture,true)}</b><small>{money(propertyTotal,true)} × (1 + {propertyGrowth}%)^{years}</small></article><article className="focus"><span>Existing investments</span><b>{money(investmentFuture,true)}</b><small>Each investment uses its own base return and addition frequency</small></article><article><span>Invested future surplus</span><b>{money(surplusFuture,true)}</b><small>{money(annualSurplus,true)}/year compounded at {surplusReturn}%</small></article></div>
    <article className="card forecast-explain"><div className="card-title"><span><small>CALCULATION EXPLAINER</small><h2>Where the result comes from</h2></span></div>
      <div className="explain-table"><span>Component</span><span>Current input</span><span>Rule used</span><span>Forecast value</span>
        <b>Properties</b><span>{money(propertyTotal,true)}</span><span>Compound at {propertyGrowth}% each year</span><strong>{money(propertyFuture,true)}</strong>
        <b>Existing investments</b><span>{money(investmentTotal,true)}</span><span>Asset-specific return + scheduled additions</span><strong>{money(investmentFuture,true)}</strong>
        <b>Future surplus invested</b><span>{money(monthlyIncome-monthlySpend)}/month</span><span>{surplusInvested}% invested at {surplusReturn}%</span><strong>{money(surplusFuture,true)}</strong>
        <b>Outstanding debt</b><span>{money(debt,true)}</span><span>{debtPaid}% repaid by scenario end</span><strong>− {money(remainingDebt,true)}</strong>
        <b>Monthly cash flow in {2026+years}</b><span>{money(monthlyIncome)} income</span><span>Income +{incomeGrowth}%; costs +{expenseInflation}% yearly</span><strong>{money(futureIncome-futureExpense)}</strong>
      </div>
    </article>
    <article className="card trajectory"><div className="card-title"><span><small>YEAR-BY-YEAR TRAJECTORY</small><h2>Projected net worth path</h2></span><b>{money(scenarioNet,true)}</b></div><MiniLine points={linePoints} color="#7658ff"/><div className="year-labels"><span>2026<br/><b>{money(yearly[0].value,true)}</b></span><span>{2026+Math.floor(years/2)}<br/><b>{money(yearly[Math.floor(years/2)].value,true)}</b></span><span>{2026+years}<br/><b>{money(yearly[years].value,true)}</b></span></div></article>
    <div className="forecast-list">{investments.filter(r=>r.value>0).map((inv,i)=><article className="card" key={inv.name}><div><i style={{background:palette[i%palette.length]}}/><span><b>{inv.name}</b><small>Current {money(inv.value,true)} · base {inv.base}%</small></span></div><MiniLine points={[inv.value,calcInvestment(inv,inv.base,Math.floor(years/2)),calcInvestment(inv,inv.base)]} color={palette[i%palette.length]}/><div className="forecast-values"><span>Downside <b>{money(calcInvestment(inv,inv.low),true)}</b></span><span>Base <b>{money(calcInvestment(inv,inv.base),true)}</b></span><span>Upside <b>{money(calcInvestment(inv,inv.high),true)}</b></span></div></article>)}</div>
    <section className="retirement scenario-retirement">
      <div className="retire-hero"><span><small>RETIREMENT SCENARIO</small><h2>{retirementFunding>=100?"Retirement resources cover the modelled need.":"Retirement plan shows a funding gap."}</h2><p>Uses the same live investment scenario above</p></span><strong>{Math.round(retirementFunding)}<i>%</i></strong></div>
      <div className="retire-grid"><article className="card assumptions"><div className="card-title"><span><small>RETIREMENT INPUTS</small><h2>Adjust the retirement case</h2></span></div>
        <label>Current age<input value={40} disabled/></label><label>Retirement age<input type="number" value={retireAge} onChange={e=>setRetireAge(Number(e.target.value))}/></label><label>Monthly lifestyle cost today<input type="number" value={retireExpense} onChange={e=>setRetireExpense(Number(e.target.value))}/></label><label>Expense inflation<input type="number" value={retireInflation} onChange={e=>setRetireInflation(Number(e.target.value))}/></label>
      </article><article className="card retire-table"><div className="card-title"><span><small>NEED VS RESOURCES</small><h2>Retirement calculation</h2></span></div>
        <div><span>Years to retirement</span><b>{yearsToRetire} years</b></div><div><span>Monthly need today</span><b>{money(retireExpense)}</b></div><div><span>Inflation-adjusted monthly need</span><b>{money(expenseAtRetire)}</b></div><div><span>Required corpus (25× annual expense)</span><b>{money(retirementCorpus,true)}</b></div><div><span>Scenario wealth available</span><b>{money(retirementNet,true)}</b></div><div className={retirementNet>=retirementCorpus?"positive":"negative"}><span>Surplus / shortfall</span><b>{money(retirementNet-retirementCorpus,true)}</b></div>
      </article></div>
      <article className="card retirement-income"><div className="card-title"><span><small>RETIREMENT INCOME</small><h2>Inflation-adjusted rent from investment properties</h2></span></div><div className="income-table"><span>Property</span><span>Rent starts</span><span>Rent today</span><span>At retirement*</span>{properties.filter(p=>p.rent>0).map(p=><><b key={p.id+"n"}>{p.name}</b><span key={p.id+"s"}>{p.rentStart||"Now"}</span><span key={p.id+"r"}>{money(p.rent)}</span><strong key={p.id+"f"}>{money(p.rent*Math.pow(1.05,yearsToRetire))}</strong></>)}</div><small>*Assumes 5% annual rent growth. GIFT City rent starts in 2029.</small></article>
    </section>
  </section>;
}
