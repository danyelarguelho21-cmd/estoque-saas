"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { salesApi } from "@/lib/api/sales";
import type { Customer } from "@/lib/api/types";

interface NewCustomerDialogProps {
  /** Chamado com o cliente recém-criado (ex.: para já selecioná-lo na venda). */
  onCreated?: (customer: Customer) => void;
  /** Botão customizado que abre o diálogo; padrão = botão "Novo cliente". */
  trigger?: ReactNode;
}

// Cadastro rápido de cliente — usado na página Clientes e direto na tela de Nova venda.
export function NewCustomerDialog({ onCreated, trigger }: NewCustomerDialogProps) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // O diálogo é renderizado em portal, mas o evento React de submit ainda sobe para o
    // formulário "pai" (ex.: o da Nova venda) — impede que finalize a venda sem querer.
    event.stopPropagation();
    if (!name.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const customer = await salesApi.createCustomer({
        name: name.trim(),
        ...(document ? { document } : {}),
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      });
      notify({ title: "Cliente cadastrado", variant: "success" });
      setOpen(false);
      setName("");
      setDocument("");
      setPhone("");
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      onCreated?.(customer);
    } catch {
      setError("Não foi possível cadastrar o cliente. Verifique os dados e tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" />
            Novo cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title="Novo cliente">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Field label="Nome" htmlFor="customerName" required>
            <Input id="customerName" required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="CPF/CNPJ" htmlFor="customerDocument" hint="Opcional; pessoa física pode ser cadastrada sem documento">
            <Input id="customerDocument" value={document} onChange={(e) => setDocument(e.target.value)} />
          </Field>
          <Field label="Telefone" htmlFor="customerPhone">
            <Input id="customerPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="E-mail" htmlFor="customerEmail">
            <Input id="customerEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Cadastrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
