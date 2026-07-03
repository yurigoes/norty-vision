"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * SystemDialog — modais/toasts no TEMA do sistema, substituindo os nativos do
 * navegador (window.alert/confirm). Uso:
 *
 *   const { confirm, alert, toast } = useDialog();
 *   if (await confirm({ message: "Excluir?", tone: "danger" })) { ... }
 *   toast("Salvo!", "success");
 */

type Tone = "default" | "danger";
type ToastTone = "success" | "error" | "info";

interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
}
interface AlertOpts {
  title?: string;
  message: string;
  okLabel?: string;
}
interface PromptOpts {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
}

interface DialogContextValue {
  confirm: (opts: ConfirmOpts | string) => Promise<boolean>;
  alert: (opts: AlertOpts | string) => Promise<void>;
  /** Pede um texto; resolve null se cancelar. */
  prompt: (opts: PromptOpts | string) => Promise<string | null>;
  toast: (message: string, tone?: ToastTone) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog precisa do <DialogProvider>");
  return ctx;
}

interface ModalState {
  kind: "confirm" | "alert" | "prompt";
  title?: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone: Tone;
  placeholder?: string;
  resolve: (v: boolean) => void;
  resolvePrompt?: (v: string | null) => void;
}
interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastSeq = useRef(0);

  const closeModal = useCallback((value: boolean) => {
    setModal((m) => {
      if (m?.kind === "prompt") m.resolvePrompt?.(value ? promptValue : null);
      else m?.resolve(value);
      return null;
    });
  }, [promptValue]);

  const confirm = useCallback((opts: ConfirmOpts | string) => {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setModal({
        kind: "confirm",
        title: o.title,
        message: o.message,
        confirmLabel: o.confirmLabel ?? "Confirmar",
        cancelLabel: o.cancelLabel ?? "Cancelar",
        tone: o.tone ?? "default",
        resolve,
      });
    });
  }, []);

  const alert = useCallback((opts: AlertOpts | string) => {
    const o = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<void>((resolve) => {
      setModal({
        kind: "alert",
        title: o.title,
        message: o.message,
        confirmLabel: o.okLabel ?? "Entendi",
        tone: "default",
        resolve: () => resolve(),
      });
    });
  }, []);

  const prompt = useCallback((opts: PromptOpts | string) => {
    const o = typeof opts === "string" ? { message: opts } : opts;
    setPromptValue(o.defaultValue ?? "");
    return new Promise<string | null>((resolvePrompt) => {
      setModal({
        kind: "prompt",
        title: o.title,
        message: o.message,
        confirmLabel: o.confirmLabel ?? "Confirmar",
        cancelLabel: "Cancelar",
        tone: "default",
        placeholder: o.placeholder,
        resolve: () => {},
        resolvePrompt,
      });
    });
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, alert, prompt, toast }}>
      {children}

      {/* ---- modal ---- */}
      {modal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-route-fade"
          onClick={() => modal.kind === "alert" && closeModal(true)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-sm rounded-2xl border border-line p-6 shadow-2xl"
          >
            {modal.title && (
              <h2 className="mb-1 text-lg font-semibold text-fg">{modal.title}</h2>
            )}
            <p className="text-sm leading-relaxed text-muted">{modal.message}</p>
            {modal.kind === "prompt" && (
              <input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") closeModal(true); }}
                placeholder={modal.placeholder}
                className="mt-4 w-full rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm"
              />
            )}
            <div className="mt-6 flex justify-end gap-2">
              {(modal.kind === "confirm" || modal.kind === "prompt") && (
                <button
                  onClick={() => closeModal(false)}
                  className="rounded-lg border border-line px-4 py-2 text-sm transition hover:bg-fg/5"
                >
                  {modal.cancelLabel}
                </button>
              )}
              <button
                autoFocus={modal.kind !== "prompt"}
                onClick={() => closeModal(true)}
                className={
                  "rounded-lg px-4 py-2 text-sm font-semibold text-white transition " +
                  (modal.tone === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-brand hover:opacity-90")
                }
              >
                {modal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- toasts ---- */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[110] flex flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={
                "animate-route-fade rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm " +
                (t.tone === "success"
                  ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-200"
                  : t.tone === "error"
                    ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200"
                    : "border-line bg-bg/80 text-fg")
              }
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
    </DialogContext.Provider>
  );
}
