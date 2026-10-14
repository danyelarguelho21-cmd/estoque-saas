"use client";

import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { signIn } from "next-auth/react";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { PageSpinner } from "@/components/ui/spinner";
import { tenantsApi } from "@/lib/api/tenants";
import { ApiError } from "@/lib/api/client";

function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const inviteQuery = useQuery({
    queryKey: ["invite", token],
    queryFn: () => tenantsApi.getInvite(token),
    enabled: Boolean(token),
    retry: false,
  });

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setSubmitting(true);
    try {
      const { email } = await tenantsApi.acceptInvite(token, password);
      const result = await signIn("credentials", { email, password, redirect: false, callbackUrl: "/painel" });
      router.push(result && !result.error ? "/painel" : "/entrar");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível aceitar o convite agora.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Convite inválido">
        <Alert variant="danger">O link do convite está incompleto. Peça um novo convite ao administrador.</Alert>
      </AuthShell>
    );
  }

  if (inviteQuery.isLoading) {
    return (
      <AuthShell title="Carregando convite…">
        <PageSpinner />
      </AuthShell>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    const message =
      inviteQuery.error instanceof ApiError ? inviteQuery.error.message : "Convite inválido ou expirado. Peça um novo ao administrador.";
    return (
      <AuthShell title="Convite indisponível">
        <div className="flex flex-col gap-4">
          <Alert variant="warning">{message}</Alert>
          <Button asChild variant="outline">
            <Link href="/entrar">Ir para o login</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  const invite = inviteQuery.data;
  return (
    <AuthShell title={`Bem-vindo(a), ${invite.name.split(" ")[0]}!`} description={`Você foi convidado(a) para a ${invite.tenantName}. Crie sua senha para entrar.`}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {error && <Alert variant="danger">{error}</Alert>}
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" value={invite.email} disabled readOnly />
        </Field>
        <Field label="Crie uma senha" htmlFor="password" hint="Mínimo de 8 caracteres" required>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirme a senha" htmlFor="confirm" required>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" loading={submitting} className="w-full">
          Aceitar convite e entrar
        </Button>
      </form>
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
