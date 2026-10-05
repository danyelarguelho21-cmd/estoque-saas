import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Suporte Zolo pelo WhatsApp — (67) 99876-8049. Único lugar com o número e a mensagem inicial. */
export const SUPPORT_WHATSAPP_DISPLAY = "(67) 99876-8049";
export const SUPPORT_WHATSAPP_URL =
  "https://wa.me/5567998768049?text=" + encodeURIComponent("Olá! Preciso de suporte no Zolo.");

/** Cartão no rodapé do menu lateral. */
export function SidebarSupportCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-[var(--color-border)] bg-slate-50 p-3", className)}>
      <p className="text-sm font-semibold text-slate-900">Precisa de ajuda?</p>
      <p className="mt-0.5 text-xs text-[var(--color-muted)]">Fale com o suporte Zolo no WhatsApp.</p>
      <a
        href={SUPPORT_WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center justify-center gap-2 rounded-md bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {SUPPORT_WHATSAPP_DISPLAY}
      </a>
    </div>
  );
}

/** Botão flutuante, visível em todas as telas do sistema (inclusive no celular). */
export function FloatingWhatsAppButton() {
  return (
    <a
      href={SUPPORT_WHATSAPP_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={`Suporte pelo WhatsApp ${SUPPORT_WHATSAPP_DISPLAY}`}
      title="Suporte pelo WhatsApp"
      className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-offset-4 print:hidden"
    >
      <svg viewBox="0 0 32 32" className="h-7 w-7" fill="currentColor" aria-hidden>
        <path d="M16.04 3C9.4 3 4 8.36 4 14.97c0 2.11.56 4.17 1.62 5.99L4 29l8.26-2.15a12.1 12.1 0 0 0 3.78.6C22.68 27.45 28 22.1 28 15.5 28 8.36 22.68 3 16.04 3Zm0 22.37c-1.2 0-2.38-.2-3.5-.6l-.6-.2-4.9 1.28 1.31-4.76-.4-.62a9.86 9.86 0 0 1-1.55-5.3c0-5.47 4.47-9.92 9.97-9.92 5.48 0 9.86 4.45 9.86 10.25 0 5.47-4.42 9.87-10.19 9.87Zm5.47-7.4c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.48.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z" />
      </svg>
    </a>
  );
}
