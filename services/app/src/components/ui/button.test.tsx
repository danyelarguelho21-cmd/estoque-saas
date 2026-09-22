import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders as a native button with the loading spinner when loading", () => {
    render(<Button loading>Salvar</Button>);
    const button = screen.getByRole("button", { name: /salvar/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  /**
   * Regressão: Radix Slot (usado via `asChild`) exige exatamente UM elemento React filho.
   * Antes da correção, o Button injetava o spinner de loading como irmão de `children` mesmo
   * quando `asChild` estava ativo, o que quebrava `next build` (erro "Slot failed to slot onto
   * its children") em toda página que usa `<Button asChild><Link .../></Button>` — descoberto
   * via `npm run build`, não pelo oracle de typecheck/lint. Este teste impede a regressão.
   */
  it("passes exactly one child through to the rendered element when asChild is used", () => {
    render(
      <Button asChild>
        <a href="/painel">Voltar</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: /voltar/i });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/painel");
  });

  it("applies the danger variant class", () => {
    render(<Button variant="danger">Remover</Button>);
    expect(screen.getByRole("button", { name: /remover/i }).className).toContain("bg-[var(--color-danger)]");
  });
});
