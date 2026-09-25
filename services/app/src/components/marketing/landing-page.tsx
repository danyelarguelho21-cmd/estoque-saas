"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { LiveDemo } from "@/components/marketing/live-demo";
import "./landing.css";

/**
 * Landing page pública (marketing). Identidade visual própria (Bricolage Grotesque + Inter +
 * JetBrains Mono, paleta esmeralda/dourado), deliberadamente separada do design system do
 * painel interno (globals.css / @theme) — todo o CSS abaixo vem escopado em `.zolo-landing`
 * (ver ./landing.css) para nunca vazar pro resto do app.
 *
 * Portado 1:1 a partir da prévia estática aprovada (zolo-landing-preview.html, V10), incluindo
 * o comportamento de scroll-reveal bidirecional, os contadores animados e a demonstração
 * interativa (ver ./live-demo.tsx).
 */

// ---------------------------------------------------------------------------
// Reveal: aparece ao entrar na viewport e desaparece ao sair, tanto descendo quanto subindo
// a página (mesmo comportamento do IntersectionObserver bidirecional da prévia estática).
// ---------------------------------------------------------------------------
function Reveal({
  children,
  delay,
  className = "",
  as: Tag = "div",
  initialInView = false,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "span";
  initialInView?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(initialInView);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => setInView(e.isIntersecting));
      },
      { threshold: 0.15, rootMargin: "-40px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const delayClass = delay ? ` reveal-delay-${delay}` : "";
  const Comp = Tag as "div";
  return (
    <Comp ref={ref} className={`reveal${delayClass}${inView ? " in" : ""} ${className}`.trim()}>
      {children}
    </Comp>
  );
}

// ---------------------------------------------------------------------------
// CountUp: conta de 0 até o valor alvo uma única vez, na primeira vez que entra na tela.
// ---------------------------------------------------------------------------
function useCountUp(target: number, active: boolean, steps = 40, intervalMs = 25) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cur = 0;
    const step = Math.max(1, Math.round(target / steps));
    const t = window.setInterval(() => {
      cur += step;
      if (cur >= target) {
        cur = target;
        window.clearInterval(t);
      }
      setValue(cur);
    }, intervalMs);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return value;
}

function useOnceInView<T extends HTMLElement>(threshold = 0.4) {
  const ref = useRef<T | null>(null);
  const [triggered, setTriggered] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || triggered) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setTriggered(true);
            io.unobserve(e.target);
          }
        });
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, triggered] as const;
}

function StatCell({ target, suffix = "", label, fill, delay }: { target: number; suffix?: string; label: string; fill: number; delay: number }) {
  const [ref, triggered] = useOnceInView<HTMLDivElement>(0.5);
  const value = useCountUp(target, triggered);
  return (
    <Reveal delay={delay} className="stat-cell">
      <div ref={ref}>
        <div className="n">{value.toLocaleString("pt-BR")}{suffix}</div>
        <div className="l">{label}</div>
        <div className="bar"><i style={{ width: triggered ? `${fill}%` : 0 }} /></div>
      </div>
    </Reveal>
  );
}

function PriceNum({ cents }: { cents: number }) {
  const [ref, triggered] = useOnceInView<HTMLSpanElement>(0.4);
  const value = useCountUp(cents, triggered, 36, 22);
  return (
    <span ref={ref} className="price-num">
      {(value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
const PLANS: { name: string; tagline: string; priceCents: number; items: string[]; highlight?: boolean }[] = [
  {
    name: "Básico",
    tagline: "Pra quem tem uma loja e quer sair da planilha.",
    priceCents: 14990,
    items: ["Até 100 produtos", "2 usuários", "1 loja", "Controle de validade/lote (FEFO)", "Importação por CSV", "Importação de NF-e do fornecedor"],
  },
  {
    name: "Pro",
    tagline: "Pra quem já opera mais de um ponto de venda.",
    priceCents: 25000,
    items: ["Até 500 produtos", "10 usuários", "3 lojas", "Tudo do Básico", "Dashboard avançado (curva ABC, giro)"],
    highlight: true,
  },
  {
    name: "Enterprise",
    tagline: "Pra operação maior, com times e várias lojas.",
    priceCents: 35000,
    items: ["Até 1.000 produtos", "20 usuários", "5 lojas", "Tudo do Pro", "Suporte prioritário"],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: "Preciso saber mexer em sistema pra usar o Zolo?", a: "Não. Se você sabe usar WhatsApp e planilha, sabe usar o Zolo. O cadastro de produto é simples, e você pode importar o que já tem por CSV em vez de digitar item por item." },
  { q: "Dá pra importar o estoque que eu já tenho?", a: "Dá. Você sobe uma planilha CSV com seus produtos e o sistema cadastra tudo de uma vez. A partir daí, as entradas seguintes podem vir automaticamente pelas notas fiscais dos seus fornecedores." },
  { q: "Como funciona a importação de nota fiscal (NF-e)?", a: "Você sobe o arquivo XML que o fornecedor te manda. O Zolo lê a nota, reconhece os produtos pelo código de barras e já monta a entrada de estoque. Você só confirma antes de gravar." },
  { q: "O Zolo emite nota fiscal de venda (NF-e/NFC-e)?", a: "Ainda não. Hoje o Zolo importa as notas de entrada dos seus fornecedores automaticamente. Emissão de nota de venda está no roadmap." },
  { q: "Meus dados ficam misturados com os de outras empresas que usam o Zolo?", a: "Não. O isolamento entre empresas é garantido no próprio banco de dados (Row-Level Security), não só numa tela." },
  { q: "Funciona pra farmácia ou mercado que precisa controlar validade?", a: "Sim. O controle por lote e validade (com sugestão FEFO) é um módulo que você liga por empresa." },
  { q: "Preciso colocar cartão de crédito pra só dar uma olhada?", a: "Pra só ver como funciona, não. Use a demonstração interativa desta página, sem cadastro." },
  { q: "Posso cancelar quando quiser?", a: "Pode. Não tem fidelidade nem multa de cancelamento." },
  { q: "O Zolo funciona no celular?", a: "Funciona direto do navegador do celular, sem precisar instalar nada." },
  { q: "Dá pra ter mais de uma loja ou depósito?", a: "Dá, conforme o limite do seu plano. Consolidado ou separado por loja, do jeito que sua operação funciona." },
  { q: "Se eu tiver dúvida, tem alguém pra me ajudar?", a: "Tem. Suporte direto pelo WhatsApp, de segunda a sexta em horário comercial, em todos os planos. No Enterprise o atendimento é prioritário." },
];

const MARQUEE_ITEMS = ["🛒 Varejo", "💊 Farmácia", "🏪 Mercado", "📦 Distribuidora", "🧾 Importa NF-e", "⏰ Controle de validade"];

const FEATURES: { title: string; desc: string; icon: ReactNode }[] = [
  { title: "Importação de NF-e", desc: "Entrada automática a partir do XML da nota do fornecedor, com revisão antes de confirmar.",
    icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /> },
  { title: "Validade e FEFO", desc: "Alerta configurável de vencimento e sugestão automática de qual lote vender primeiro.",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></> },
  { title: "Múltiplas lojas", desc: "Estoque consolidado ou separado por loja/depósito, do jeito que sua operação funciona.",
    icon: <path d="M3 9l1.5-5h15L21 9M4 9v11h16V9M3 9a2.2 2.2 0 0 0 4.2 1 2.2 2.2 0 0 0 4.2 0 2.2 2.2 0 0 0 4.2 0 2.2 2.2 0 0 0 4.2-1M9.5 20v-6h5v6" /> },
  { title: "Papéis de acesso", desc: "Admin, operador e vendedor: cada um vê e faz só o que precisa.",
    icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" /><circle cx="17.2" cy="8.6" r="2.6" /><path d="M15.2 14.9c2.6 0.3 4.5 2.3 4.5 5.1" /></> },
  { title: "Isolamento real de dados", desc: "Cada empresa cliente tem seus dados isolados no próprio banco, reforçado por Row-Level Security.",
    icon: <><path d="M12 2.5l7.5 3.2v5.6c0 4.6-3.1 8-7.5 9.7-4.4-1.7-7.5-5.1-7.5-9.7V5.7z" /><path d="M8.7 12l2.2 2.2 4-4.5" /></> },
  { title: "Dashboards", desc: "Curva ABC, giro de estoque, produtos parados e mais vendidos, sem planilha.",
    icon: <path d="M4 20V11M12 20V4M20 20v-8M2.5 20h19" /> },
  { title: "Etiqueta com código de barras", desc: "Selecionou o produto? Gera o código de barras e imprime a etiqueta pronta pra colar na prateleira, sem depender de outro programa.",
    icon: <><path d="M12.6 2.6H4.6a1 1 0 0 0-1 1v8l9.7 9.7a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8z" /><circle cx="7.7" cy="7.7" r="1.4" fill="currentColor" stroke="none" /></> },
  { title: "Busca por código de barras", desc: "Digite ou leia com um leitor de código de barras USB/Bluetooth pra achar o produto na hora de vender, repor ou transferir estoque.",
    icon: <path d="M3 8V5a1 1 0 0 1 1-1h3M17 4h3a1 1 0 0 1 1 1v3M21 16v3a1 1 0 0 1-1 1h-3M7 20H4a1 1 0 0 1-1-1v-3M5 12h14" /> },
  { title: "Suporte pelo WhatsApp", desc: "Fala direto com o suporte pelo WhatsApp, de segunda a sexta em horário comercial. Sem robô, sem fila de ticket.",
    icon: <path d="M20.5 11.5a8 8 0 0 1-11.9 7L4 20l1.5-4.4a8 8 0 1 1 15-4.1z" /> },
];

export function LandingPage() {
  const mockWrapRef = useRef<HTMLDivElement | null>(null);
  const mockTiltRef = useRef<HTMLDivElement | null>(null);
  const [openFaq, setOpenFaq] = useState<Set<number>>(new Set());

  function handleMockMove(e: MouseEvent<HTMLDivElement>) {
    const wrap = mockWrapRef.current;
    const tilt = mockTiltRef.current;
    if (!wrap || !tilt) return;
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    tilt.style.transform = `rotateY(${-7 + x * 14}deg) rotateX(${3 - y * 10}deg)`;
  }

  function handleMockLeave() {
    const tilt = mockTiltRef.current;
    if (tilt) tilt.style.transform = "rotateY(-7deg) rotateX(3deg)";
  }

  function toggleFaq(i: number) {
    setOpenFaq((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="zolo-landing">
      <header className="site">
        <div className="wrap bar">
          <span className="logo">
            <span className="mark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 7l2-4h14l2 4" /><path d="M9 12h6" />
              </svg>
            </span>
            Zolo
          </span>
          <nav className="links">
            <a href="#como-funciona">Como funciona</a>
            <a href="#recursos">Recursos</a>
            <a href="#precos">Preços</a>
            <a href="#faq">Dúvidas</a>
          </nav>
          <div style={{ display: "flex", gap: 8 }}>
            <Link className="btn btn-ghost" href="/entrar">Entrar</Link>
            <Link className="btn btn-primary" href="/cadastro">Começar agora</Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="grain" />
        <div className="glow glow1" />
        <div className="glow glow2" />
        <div className="wrap hero-inner">
          <div className="hero-grid">
            <Reveal initialInView>
              <span className="badge badge-cream"><span className="dot-pulse" /> Early access aberto agora</span>
              <h1>Pare de descobrir que faltou estoque <em>só quando o cliente já foi embora.</em></h1>
              <p className="lead">O Zolo dá entrada automática pelas notas dos seus fornecedores, avisa antes de faltar ou vencer, e mostra o giro do seu estoque em tempo real, sem planilha e sem digitar item por item.</p>
              <div className="cta-row">
                <Link className="btn btn-accent btn-lg" href="/cadastro">Quero organizar meu estoque →</Link>
                <a className="btn btn-dark-outline btn-lg" href="#demo">▶ Ver funcionando agora</a>
              </div>
              <p className="fine">SEM FIDELIDADE · CANCELE QUANDO QUISER · A PARTIR DE R$ 149,90/MÊS</p>
            </Reveal>
            <Reveal delay={2} initialInView>
              <div className="mock-wrap" ref={mockWrapRef} onMouseMove={handleMockMove} onMouseLeave={handleMockLeave}>
                <div className="mock chrome chrome-dark" ref={mockTiltRef}>
                  <div className="chrome-bar"><span className="r" /><span className="y" /><span className="g" /><span className="url">app.usezolo.com.br/painel</span></div>
                  <div className="mock-body">
                    <div className="mock-row"><span>Giro de estoque (mês)</span><span className="up">↑ saudável</span></div>
                    <div className="mock-row"><span>Produtos com estoque baixo</span><span style={{ color: "#e3b458" }}>3 alertas</span></div>
                    <div className="mock-chart">
                      {[35, 55, 40, 70, 50, 85, 65, 95].map((h, i) => (
                        <i key={i} style={{ height: `${h}%`, animationDelay: `${0.05 + i * 0.05}s` }} />
                      ))}
                    </div>
                    <div className="mock-row"><span>Curva ABC</span><span style={{ color: "#7fd9c3" }}>atualizada agora</span></div>
                  </div>
                  <div className="float-chip chip-a">✓ NF-e importada</div>
                  <div className="float-chip chip-b">⏰ Vence em 3d</div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <div className="marquee-band">
        <div className="marquee">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => <span key={i}>{item}</span>)}
        </div>
      </div>

      <section style={{ paddingTop: 80 }}>
        <div className="wrap">
          <span className="eyebrow center">O problema</span>
          <Reveal as="div" className="center"><h2>Se seu estoque hoje mora numa planilha <em>(ou na cabeça de alguém)</em>, você já sentiu isso:</h2></Reveal>
          <div className="grid-4">
            <Reveal delay={1} className="card"><div className="icon-badge">📉</div><strong>Ruptura de estoque</strong><p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>O cliente pede, você olha na prateleira e não tem, e ninguém percebeu antes.</p></Reveal>
            <Reveal delay={2} className="card"><div className="icon-badge">⏰</div><strong>Perda por vencimento</strong><p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>Produto perecível vence parado no fundo do estoque porque ninguém vendeu o lote certo primeiro.</p></Reveal>
            <Reveal delay={3} className="card"><div className="icon-badge">📊</div><strong>Zero visão do negócio</strong><p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>Você não sabe o que gira rápido, o que empaca, e o que já devia ter saído do catálogo.</p></Reveal>
            <Reveal delay={4} className="card"><div className="icon-badge">🏬</div><strong>Múltiplas lojas, um caos</strong><p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8 }}>Cada loja/depósito controla do seu jeito, e bater os números no fim do mês vira trabalho manual.</p></Reveal>
          </div>
        </div>
      </section>

      <section id="demo" className="band-cream2">
        <div className="wrap">
          <span className="eyebrow center">Veja funcionando</span>
          <Reveal as="div" className="center"><h2>Isso aqui é o <em>Zolo de verdade</em>, reagindo agora</h2></Reveal>
          <Reveal delay={1} as="div" className="center"><p className="lead" style={{ marginTop: 12 }}>Sem cadastro. Escolhe o tipo de negócio, clica nos botões e observa a tabela, os alertas e os números mudando sozinhos, ao vivo.</p></Reveal>
          <Reveal delay={2}>
            <LiveDemo />
          </Reveal>
        </div>
      </section>

      <section id="como-funciona">
        <div className="wrap">
          <span className="eyebrow center">O mecanismo</span>
          <Reveal as="div" className="center"><h2>Como o <em>Zolo</em> funciona</h2></Reveal>
          <Reveal delay={1} as="div" className="center"><p className="lead" style={{ marginTop: 12 }}>Três passos: o mesmo mecanismo que você acabou de testar na demonstração acima.</p></Reveal>
          <div className="grid-3">
            <div className="timeline-line" />
            <Reveal delay={1} className="step">
              <span className="num">1</span>
              <div style={{ fontWeight: 700, marginTop: 16, fontSize: 18, fontFamily: "var(--font-bricolage),sans-serif", letterSpacing: "-0.01em" }}>Importe seu estoque</div>
              <p style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 8 }}>Suba seu catálogo atual por CSV, gere a etiqueta com código de barras pra quem ainda não tem, e deixe as próximas entradas chegarem sozinhas pelo XML da nota do fornecedor.</p>
            </Reveal>
            <Reveal delay={2} className="step">
              <span className="num">2</span>
              <div style={{ fontWeight: 700, marginTop: 16, fontSize: 18, fontFamily: "var(--font-bricolage),sans-serif", letterSpacing: "-0.01em" }}>Venda e controle automático</div>
              <p style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 8 }}>Bipe o produto ou busque pelo nome na hora da venda. O estoque é debitado na hora, e se for perecível, o Zolo sugere qual lote sair primeiro pra não perder por vencimento.</p>
            </Reveal>
            <Reveal delay={3} className="step">
              <span className="num">3</span>
              <div style={{ fontWeight: 700, marginTop: 16, fontSize: 18, fontFamily: "var(--font-bricolage),sans-serif", letterSpacing: "-0.01em" }}>Acompanhe pelo dashboard</div>
              <p style={{ color: "var(--muted)", fontSize: 14.5, marginTop: 8 }}>Curva ABC, giro por produto, produtos parados e alertas de estoque baixo, tudo num painel, sem planilha manual.</p>
            </Reveal>
          </div>

          <span className="eyebrow center" style={{ marginTop: 64 }}>Números do próprio sistema</span>
          <div className="stat-grid">
            <StatCell delay={1} target={1000} label="Produtos suportados (Enterprise)" fill={100} />
            <StatCell delay={2} target={20} label="Usuários simultâneos" fill={80} />
            <StatCell delay={3} target={5} label="Lojas por empresa" fill={60} />
            <StatCell delay={4} target={100} suffix="%" label="Isolamento entre empresas (RLS)" fill={100} />
          </div>
        </div>
      </section>

      <section id="recursos" className="band-cream2">
        <div className="wrap">
          <span className="eyebrow center">Recursos</span>
          <Reveal as="div" className="center"><h2>Feito pra operação <em>de verdade</em> de uma PME brasileira</h2></Reveal>
          <div className="grid-6">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={Math.min(i + 1, 8)} className="feat">
                <div className="icon-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{f.icon}</svg>
                </div>
                <div><strong>{f.title}</strong><p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>{f.desc}</p></div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="precos" className="band-cream2">
        <div className="precos-glow g1" /><div className="precos-glow g2" />
        <div className="wrap">
          <span className="eyebrow center">Planos</span>
          <Reveal as="div" className="center"><h2>Planos simples, <em>sem letra miúda</em></h2></Reveal>
          <Reveal delay={1} as="div" className="center"><p className="lead" style={{ marginTop: 12 }}>Escolha pelo tamanho da sua operação. Mude de plano quando quiser.</p></Reveal>
          <div className="pricing-grid">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.name} delay={i + 1} className={`plan${plan.highlight ? " highlight" : ""}`}>
                {plan.highlight && <span className="badge badge-gold" style={{ width: "fit-content", marginBottom: 10 }}>★ Mais escolhido</span>}
                <strong style={{ fontSize: 17 }}>{plan.name}</strong>
                <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>{plan.tagline}</p>
                <div className="price">R$ <PriceNum cents={plan.priceCents} /><span>/mês</span></div>
                <ul>{plan.items.map((item) => <li key={item}>{item}</li>)}</ul>
                <Link
                  className={plan.highlight ? "btn btn-accent" : "btn btn-outline"}
                  style={{ marginTop: "auto" }}
                  href={`/cadastro?plano=${encodeURIComponent(plan.name)}`}
                >
                  Assinar {plan.name}
                </Link>
              </Reveal>
            ))}
          </div>
          <p className="fine" style={{ textAlign: "center", marginTop: 26 }}>PAGAMENTO POR CARTÃO (RECORRÊNCIA AUTOMÁTICA) OU PIX/BOLETO. SEM FIDELIDADE.</p>
        </div>
      </section>

      <section id="faq">
        <div className="wrap" style={{ maxWidth: 740 }}>
          <span className="eyebrow center">Dúvidas</span>
          <Reveal as="div" className="center"><h2>Perguntas <em>frequentes</em></h2></Reveal>
          <Reveal delay={1} className="" >
            <div style={{ marginTop: 40 }}>
              {FAQ.map((item, i) => (
                <div key={item.q} className={`acc-item${openFaq.has(i) ? " open" : ""}`}>
                  <div className="acc-head" onClick={() => toggleFaq(i)}>
                    {item.q}<span className="plus">+</span>
                  </div>
                  <div className="acc-body"><div className="acc-body-inner"><p>{item.a}</p></div></div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="cta-final">
        <div className="grid-pattern" />
        <div className="wrap center">
          <h2>Seu estoque não devia depender <em>de alguém lembrar</em> de olhar a planilha.</h2>
          <p style={{ marginTop: 14, fontSize: 16.5 }}>Teste a demonstração, veja o preço, e decida sem pressa. Sem fidelidade, cancele quando quiser.</p>
          <div className="cta-row" style={{ justifyContent: "center" }}>
            <Link className="btn btn-accent btn-lg" href="/cadastro">Criar minha conta agora</Link>
            <a className="btn btn-dark-outline btn-lg" href="#demo">Testar a demonstração</a>
          </div>
        </div>
      </section>

      <footer className="site">
        <div className="wrap foot-row">
          <span className="logo">
            <span className="mark" style={{ width: 26, height: 26 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 7l2-4h14l2 4" /><path d="M9 12h6" />
              </svg>
            </span>
            Zolo
          </span>
          <span>Gestão de estoque por assinatura para pequenas e médias empresas brasileiras.</span>
          <a href="mailto:contato@usezolo.com.br">Fale conosco</a>
        </div>
      </footer>
    </div>
  );
}
