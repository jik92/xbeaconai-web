import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface TextInputModalProps {
  open: boolean;
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  submittingLabel?: string;
  maxLength?: number;
  requiredMessage?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: string) => void | Promise<void>;
}

export function TextInputModal({
  open,
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "确认",
  submittingLabel = "提交中…",
  maxLength,
  requiredMessage = "请输入内容",
  onOpenChange,
  onSubmit,
}: TextInputModalProps) {
  const inputId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setError("");
  }, [initialValue, open]);

  const setOpen = (nextOpen: boolean) => {
    if (!submitting) onOpenChange(nextOpen);
  };

  const submit = async () => {
    const cleanValue = value.trim();
    if (!cleanValue) {
      setError(requiredMessage);
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(cleanValue);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onEscapeKeyDown={(event) => submitting && event.preventDefault()}
        onPointerDownOutside={(event) => submitting && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2">
            <label className="type-label text-ink" htmlFor={inputId}>
              {label}
            </label>
            <Input
              id={inputId}
              autoFocus
              value={value}
              placeholder={placeholder}
              maxLength={maxLength}
              disabled={submitting}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError("");
              }}
            />
            {error && (
              <p id={`${inputId}-error`} className="type-helper text-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? submittingLabel : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
