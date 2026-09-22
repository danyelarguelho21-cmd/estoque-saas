"use client";

import { UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";

interface FileDropProps {
  accept: string;
  label: string;
  hint: string;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

/** Dropzone genérica para upload de arquivos (XML de NF-e, CSV de produtos). */
export function FileDrop({ accept, label, hint, onFileSelected, disabled = false }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    onFileSelected(file);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!disabled && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
      }}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        setIsDragging(false);
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--color-border)] bg-white p-8 text-center transition-colors",
        isDragging && "border-[var(--color-primary)] bg-blue-50/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <UploadCloud className="h-8 w-8 text-slate-400" aria-hidden />
      <p className="text-sm font-medium text-slate-900">{fileName ?? label}</p>
      <p className="text-xs text-[var(--color-muted)]">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => handleFiles(event.target.files)}
      />
    </div>
  );
}
