"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Demonstração interativa da landing page. Dados 100% fictícios, gerados e simulados
 * inteiramente no navegador (sem chamada de API, sem login, sem persistir nada). Objetivo:
 * deixar a pessoa "sentir" o mecanismo central do produto (entrada por NF-e, baixa automática
 * na venda, alerta de validade/FEFO, faturamento) sem precisar se cadastrar.
 *
 * Todo o estado da simulação é um único objeto `Model` em useState, atualizado sempre via forma
 * funcional (`setModel(prev => ...)`) — inclusive dentro dos setTimeout da sequência de
 * "piloto automático" (setProfile). Isso evita closures desatualizadas sem precisar ler/escrever
 * um ref durante a renderização (proibido pelas regras de hooks do React).
 */

type ProfileKey = "loja" | "distribuidora" | "negocio";

type DemoProduct = {
  id: string;
  name: string;
  stock: number;
  min: number;
  validade: number | null;
  preco: number;
};

type Profile = {
  label: string;
  url: string;
  tabLabel: string;
  fornecedores: string[];
  items: DemoProduct[];
};

const PROFILES: Record<ProfileKey, Profile> = {
  loja: {
    tabLabel: "Loja",
    label: "Painel de estoque · loja de roupas e calçados",
    url: "app.usezolo.com.br/painel",
    fornecedores: ["Confecção Malhas do Sul", "Calçados Nordeste Atacado", "Indústria Têxtil Boa Vista"],
    items: [
      { id: "1", name: "Tênis Esportivo Nº 42", stock: 34, min: 10, validade: null, preco: 199.9 },
      { id: "2", name: "Camiseta Básica P", stock: 58, min: 20, validade: null, preco: 39.9 },
      { id: "3", name: "Calça Jeans Slim 38", stock: 21, min: 15, validade: null, preco: 129.9 },
      { id: "4", name: "Jaqueta Corta-Vento M", stock: 9, min: 10, validade: null, preco: 179.9 },
      { id: "5", name: "Boné Aba Reta", stock: 27, min: 12, validade: null, preco: 49.9 },
      { id: "6", name: "Meia Cano Alto (par)", stock: 5, min: 15, validade: null, preco: 19.9 },
    ],
  },
  distribuidora: {
    tabLabel: "Distribuidora",
    label: "Painel de estoque · distribuidora regional",
    url: "app.usezolo.com.br/painel",
    fornecedores: ["Indústria Laticínios Vale Verde", "Distribuidora Atacado Sul", "Fábrica Bebidas Cristal"],
    items: [
      { id: "1", name: "Caixa Refrigerante 24un", stock: 180, min: 60, validade: null, preco: 54.0 },
      { id: "2", name: "Fardo Água Mineral 12x1,5L", stock: 95, min: 40, validade: null, preco: 28.0 },
      { id: "3", name: "Pallet Arroz 30kg (unid.)", stock: 22, min: 10, validade: null, preco: 135.0 },
      { id: "4", name: "Caixa Leite UHT 12x1L", stock: 14, min: 20, validade: 25, preco: 62.0 },
      { id: "5", name: "Fardo Papel Higiênico 16un", stock: 8, min: 15, validade: null, preco: 74.0 },
      { id: "6", name: "Caixa Iogurte 24un", stock: 5, min: 10, validade: 6, preco: 58.0 },
    ],
  },
  negocio: {
    tabLabel: "Negócio local",
    label: "Painel de estoque · farmácia de bairro",
    url: "app.usezolo.com.br/painel",
    fornecedores: ["Distribuidora Farma Center", "Drogafonte Atacado", "Comercial Higiene & Saúde"],
    items: [
      { id: "1", name: "Analgésico 20 comprimidos", stock: 64, min: 20, validade: 120, preco: 12.5 },
      { id: "2", name: "Protetor solar FPS 60", stock: 12, min: 15, validade: 200, preco: 54.9 },
      { id: "3", name: "Álcool em gel 500ml", stock: 38, min: 12, validade: null, preco: 9.9 },
      { id: "4", name: "Vitamina C efervescente", stock: 9, min: 10, validade: 45, preco: 18.9 },
      { id: "5", name: "Fralda infantil P (pacote)", stock: 5, min: 8, validade: null, preco: 34.9 },
      { id: "6", name: "Xarope infantil 100ml", stock: 3, min: 6, validade: 5, preco: 22.9 },
    ],
  },
};

const PROFILE_ORDER: ProfileKey[] = ["loja", "distribuidora", "negocio"];

type LogEntry = { id: number; text: string };
type FlyMoney = { id: number; amount: number; left: number };

type Model = {
  profileKey: ProfileKey;
  products: DemoProduct[];
  dayOffset: number;
  log: LogEntry[];
  acoes: number;
  faturamento: number;
  faturamentoHistory: number[];
  hintVisible: boolean;
  flashIds: string[];
  fly: FlyMoney[];
  bump: { total: number; alertas: number; fat: number; acoes: number };
};

function cloneProfileItems(key: ProfileKey): DemoProduct[] {
  return PROFILES[key].items.map((p) => ({ ...p }));
}

function initialModel(key: ProfileKey): Model {
  return {
    profileKey: key,
    products: cloneProfileItems(key),
    dayOffset: 0,
    log: [],
    acoes: 0,
    faturamento: 0,
    faturamentoHistory: [0],
    hintVisible: false,
    flashIds: [],
    fly: [],
    bump: { total: 0, alertas: 0, fat: 0, acoes: 0 },
  };
}

function statusFor(p: DemoProduct): { label: string; cls: string } {
  if (p.stock <= 0) return { label: "Sem estoque", cls: "badge-gold" };
  if (p.stock <= p.min) return { label: "Estoque baixo", cls: "badge-gold" };
  if (p.validade !== null && p.validade <= 5) return { label: `Vence em ${p.validade}d`, cls: "badge-info" };
  return { label: "OK", cls: "badge-accent" };
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

let logIdSeq = 0;
let flyIdSeq = 0;

export function LiveDemo() {
  const [model, setModel] = useState<Model>(() => initialModel("loja"));
  const timersRef = useRef<number[]>([]);
  const hasAutoplayedRef = useRef(false);
  const profileKeyRef = useRef<ProfileKey>("loja");
  const shellRef = useRef<HTMLDivElement | null>(null);

  function clearTimers() {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }

  function schedule(fn: () => void, delay: number) {
    timersRef.current.push(window.setTimeout(fn, delay));
  }

  function simulateNfe(manual: boolean) {
    let ids: string[] = [];
    setModel((prev) => {
      const fornecedor = pick(PROFILES[prev.profileKey].fornecedores);
      const shuffled = [...prev.products].sort(() => Math.random() - 0.5).slice(0, 3);
      ids = shuffled.map((p) => p.id);
      const products = prev.products.map((p) =>
        ids.includes(p.id) ? { ...p, stock: p.stock + Math.ceil(Math.random() * 15 + 5) } : p,
      );
      logIdSeq += 1;
      const text = `Nota fiscal da ${fornecedor} importada. ${shuffled.length} itens atualizados automaticamente, sem digitar nada.`;
      return {
        ...prev,
        products,
        log: [{ id: logIdSeq, text }, ...prev.log].slice(0, 4),
        acoes: prev.acoes + 1,
        hintVisible: manual ? false : prev.hintVisible,
        flashIds: ids,
        bump: { ...prev.bump, total: prev.bump.total + 1, alertas: prev.bump.alertas + 1, acoes: prev.bump.acoes + 1 },
      };
    });
    schedule(() => setModel((prev) => ({ ...prev, flashIds: prev.flashIds.filter((id) => !ids.includes(id)) })), 900);
  }

  function simulateVenda(manual: boolean) {
    let flashedId: string | null = null;
    let flyId: number | null = null;
    setModel((prev) => {
      const disponiveis = prev.products.filter((p) => p.stock > 0);
      if (disponiveis.length === 0) return prev;
      const alvo = pick(disponiveis);
      const qtd = Math.min(alvo.stock, Math.ceil(Math.random() * 3));
      const products = prev.products.map((p) => (p.id === alvo.id ? { ...p, stock: p.stock - qtd } : p));
      const restante = alvo.stock - qtd;
      const valorVenda = qtd * (alvo.preco || 0);
      const faturamento = prev.faturamento + valorVenda;
      const faturamentoHistory = [...prev.faturamentoHistory, faturamento].slice(-12);
      flyIdSeq += 1;
      flyId = flyIdSeq;
      const fly = [...prev.fly, { id: flyId, amount: valorVenda, left: 40 + Math.random() * 20 }];
      logIdSeq += 1;
      const belowMin = restante <= alvo.min;
      const text = belowMin
        ? `Venda registrada: ${qtd}x ${alvo.name} (R$ ${formatBRL(valorVenda)}). Estoque caiu pra ${restante}, abaixo do mínimo: alerta disparado.`
        : `Venda registrada: ${qtd}x ${alvo.name} (R$ ${formatBRL(valorVenda)}). Baixa automática no estoque, sem planilha.`;
      flashedId = alvo.id;
      return {
        ...prev,
        products,
        faturamento,
        faturamentoHistory,
        fly,
        log: [{ id: logIdSeq, text }, ...prev.log].slice(0, 4),
        acoes: prev.acoes + 1,
        hintVisible: manual ? false : prev.hintVisible,
        flashIds: [alvo.id],
        bump: {
          ...prev.bump,
          total: prev.bump.total + 1,
          fat: prev.bump.fat + 1,
          acoes: prev.bump.acoes + 1,
          alertas: belowMin ? prev.bump.alertas + 1 : prev.bump.alertas,
        },
      };
    });
    schedule(() => setModel((prev) => ({ ...prev, flashIds: prev.flashIds.filter((id) => id !== flashedId) })), 900);
    schedule(() => setModel((prev) => ({ ...prev, fly: prev.fly.filter((f) => f.id !== flyId) })), 1150);
  }

  function simulateTempo(manual: boolean) {
    let ids: string[] = [];
    setModel((prev) => {
      const dayOffset = prev.dayOffset + 3;
      ids = prev.products.filter((p) => p.validade !== null).map((p) => p.id);
      const products = prev.products.map((p) => (p.validade !== null ? { ...p, validade: Math.max(0, p.validade - 3) } : p));
      const proximo = [...products].filter((p) => p.validade !== null).sort((a, b) => (a.validade ?? 0) - (b.validade ?? 0))[0];
      logIdSeq += 1;
      const text = proximo
        ? `+3 dias. "${proximo.name}" vence em ${proximo.validade}d. O Zolo sugere vender esse lote primeiro (FEFO).`
        : "+3 dias passaram. Esse tipo de produto não vence, mas o Zolo continua de olho no giro e nos itens que estão parados no estoque.";
      return {
        ...prev,
        dayOffset,
        products,
        log: [{ id: logIdSeq, text }, ...prev.log].slice(0, 4),
        acoes: prev.acoes + 1,
        hintVisible: manual ? false : prev.hintVisible,
        flashIds: ids,
        bump: { ...prev.bump, alertas: prev.bump.alertas + 1, acoes: prev.bump.acoes + 1 },
      };
    });
    schedule(() => setModel((prev) => ({ ...prev, flashIds: prev.flashIds.filter((id) => !ids.includes(id)) })), 900);
  }

  function setProfile(key: ProfileKey) {
    clearTimers();
    profileKeyRef.current = key;
    setModel(initialModel(key));
    schedule(() => simulateNfe(false), 700);
    schedule(() => simulateVenda(false), 2000);
    schedule(() => simulateVenda(false), 3300);
    schedule(() => simulateTempo(false), 4600);
    schedule(() => setModel((prev) => ({ ...prev, hintVisible: true })), 5500);
  }

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasAutoplayedRef.current) {
            hasAutoplayedRef.current = true;
            setProfile(profileKeyRef.current);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profile = PROFILES[model.profileKey];
  const total = model.products.reduce((a, p) => a + p.stock, 0);
  const alertas = model.products.filter((p) => statusFor(p).cls !== "badge-accent").length;

  const sparkPoints = (() => {
    const pts = model.faturamentoHistory.slice(-12);
    const max = Math.max(1, ...pts);
    const n = pts.length;
    return pts.map((v, i) => `${n === 1 ? 100 : (i / (n - 1)) * 100},${(26 - (v / max) * 22).toFixed(1)}`).join(" ");
  })();

  return (
    <div>
      <div className="scan-wrap">
        <div className="scan-plate">
          <div className="ping-ring" />
          <svg className="barcode-svg" viewBox="0 0 120 56" width={150} height={70}>
            <rect x="4" y="6" width="3" height="44" /><rect x="10" y="6" width="1.5" height="44" /><rect x="14" y="6" width="4" height="44" />
            <rect x="21" y="6" width="2" height="44" /><rect x="26" y="6" width="1.5" height="44" /><rect x="30" y="6" width="3" height="44" />
            <rect x="36" y="6" width="4.5" height="44" /><rect x="43" y="6" width="1.5" height="44" /><rect x="47" y="6" width="2" height="44" />
            <rect x="52" y="6" width="3" height="44" /><rect x="58" y="6" width="1.5" height="44" /><rect x="62" y="6" width="4" height="44" />
            <rect x="69" y="6" width="2" height="44" /><rect x="74" y="6" width="3" height="44" /><rect x="79" y="6" width="1.5" height="44" />
            <rect x="83" y="6" width="4.5" height="44" /><rect x="90" y="6" width="2" height="44" /><rect x="94" y="6" width="1.5" height="44" />
            <rect x="98" y="6" width="3" height="44" /><rect x="104" y="6" width="4" height="44" /><rect x="111" y="6" width="2" height="44" /><rect x="115" y="6" width="1.5" height="44" />
          </svg>
          <div className="scan-line" />
          <span className="scan-check">✓ lido</span>
        </div>
        <span className="cart-caption">SEM CADASTRO · TESTE AO VIVO</span>
      </div>

      <div className="profile-tabs">
        {PROFILE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`tab-btn${model.profileKey === key ? " active" : ""}`}
            onClick={() => setProfile(key)}
          >
            {PROFILES[key].tabLabel}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 8, maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
        <div className="demo-shell chrome" ref={shellRef}>
          <div className="chrome-bar">
            <span className="r" /><span className="y" /><span className="g" />
            <span className="url">{profile.url}</span>
          </div>
          <div className="demo-inner">
            <div className="demo-top">
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700 }}>{profile.label}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)" }}>Direto no seu navegador, sem backend.</div>
              </div>
              <span className="badge badge-neutral">Dia +{model.dayOffset}</span>
            </div>

            <div className="demo-stats">
              <div key={`total-${model.bump.total}`} className="demo-stat stat-total bump">
                <span className="n">{total}</span>
                <span className="l">Itens em estoque</span>
              </div>
              <div key={`alertas-${model.bump.alertas}`} className="demo-stat stat-alert bump">
                <span className="n">{alertas}</span>
                <span className="l">Alertas ativos</span>
              </div>
              <div key={`fat-${model.bump.fat}`} className="demo-stat stat-fat bump">
                <div className="fly-money-zone">
                  {model.fly.map((f) => (
                    <span key={f.id} className="fly-money" style={{ left: `${f.left}%` }}>
                      +R$ {formatBRL(f.amount)}
                    </span>
                  ))}
                </div>
                <span className="n">R$ {formatBRL(model.faturamento)}</span>
                <span className="l">Faturamento</span>
                <svg className="fat-spark" viewBox="0 0 100 26" preserveAspectRatio="none">
                  <polyline points={sparkPoints} />
                </svg>
              </div>
              <div key={`acoes-${model.bump.acoes}`} className="demo-stat stat-acoes bump">
                <span className="n">{model.acoes}</span>
                <span className="l">Ações simuladas</span>
              </div>
            </div>

            <div className="demo-buttons">
              <button type="button" className="btn btn-outline" onClick={() => simulateNfe(true)}>🧾 Simular nota (NF-e)</button>
              <button type="button" className="btn btn-outline" onClick={() => simulateVenda(true)}>🛒 Simular venda</button>
              <button type="button" className="btn btn-outline" onClick={() => simulateTempo(true)}>📅 Avançar 3 dias</button>
            </div>

            <p className={`demo-hint${model.hintVisible ? " show" : ""}`}>Agora é sua vez: clica nos botões</p>

            <div className="table-wrap">
              <table>
                <thead><tr><th>Produto</th><th>Estoque</th><th>Status</th></tr></thead>
                <tbody>
                  {model.products.map((p) => {
                    const s = statusFor(p);
                    return (
                      <tr key={p.id} className={model.flashIds.includes(p.id) ? "flash" : ""}>
                        <td>{p.name}</td>
                        <td style={{ fontFamily: "var(--font-jetbrains-mono),monospace" }}>{p.stock}</td>
                        <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="log-box">
              {model.log.length === 0 ? (
                <p className="log-empty">Clique em um dos botões acima pra ver o estoque se atualizar sozinho.</p>
              ) : (
                model.log.map((entry) => (
                  <p key={entry.id} className="log-item">{entry.text}</p>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
