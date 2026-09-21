import type { ReactNode } from "react";

export const metadata = {
  title: "estoque-saas",
  description: "Gestão de estoque por assinatura para PMEs brasileiras",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
